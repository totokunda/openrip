//! Pitch-preserving speed change: FFmpeg's `atempo` (WSOLA) as a streaming filter.

use std::collections::VecDeque;
use std::ffi::CString;

use ffmpeg_sys_next as ff;

use crate::{AudioError, CHANNELS};

fn check(op: &'static str, code: i32) -> Result<i32, AudioError> {
    if code < 0 {
        Err(AudioError::Ffmpeg { op, code })
    } else {
        Ok(code)
    }
}

/// Interleaved stereo in, the same sound `speed` times faster (or slower) out, same pitch.
pub(crate) struct Tempo {
    graph: *mut ff::AVFilterGraph,
    src: *mut ff::AVFilterContext,
    sink: *mut ff::AVFilterContext,
    frame: *mut ff::AVFrame,
    rate: u32,
    out: VecDeque<f32>,
}

unsafe impl Send for Tempo {}

impl Tempo {
    pub(crate) fn new(rate: u32, speed: f64) -> Result<Tempo, AudioError> {
        unsafe {
            let mut t = Tempo { graph: ff::avfilter_graph_alloc(), src: std::ptr::null_mut(), sink: std::ptr::null_mut(), frame: ff::av_frame_alloc(), rate, out: VecDeque::new() };
            let filter = |name: &str| ff::avfilter_get_by_name(CString::new(name).unwrap().as_ptr());
            let args = CString::new(format!("sample_rate={rate}:sample_fmt=flt:channel_layout=stereo:time_base=1/{rate}")).unwrap();
            check("abuffer", ff::avfilter_graph_create_filter(&mut t.src, filter("abuffer"), c"in".as_ptr(), args.as_ptr(), std::ptr::null_mut(), t.graph))?;
            // atempo takes 0.5..100 per instance; chain halvings for slower speeds.
            let mut factors = Vec::new();
            let mut s = speed;
            while s < 0.5 {
                factors.push(0.5);
                s /= 0.5;
            }
            factors.push(s);
            let mut prev = t.src;
            for (i, f) in factors.iter().enumerate() {
                let mut ctx: *mut ff::AVFilterContext = std::ptr::null_mut();
                let name = CString::new(format!("tempo{i}")).unwrap();
                let a = CString::new(format!("tempo={f}")).unwrap();
                check("atempo", ff::avfilter_graph_create_filter(&mut ctx, filter("atempo"), name.as_ptr(), a.as_ptr(), std::ptr::null_mut(), t.graph))?;
                check("avfilter_link", ff::avfilter_link(prev, 0, ctx, 0))?;
                prev = ctx;
            }
            check("abuffersink", ff::avfilter_graph_create_filter(&mut t.sink, filter("abuffersink"), c"out".as_ptr(), std::ptr::null(), std::ptr::null_mut(), t.graph))?;
            check("avfilter_link", ff::avfilter_link(prev, 0, t.sink, 0))?;
            check("avfilter_graph_config", ff::avfilter_graph_config(t.graph, std::ptr::null_mut()))?;
            Ok(t)
        }
    }

    /// Stereo frames ready to take.
    pub(crate) fn available(&self) -> usize {
        self.out.len() / CHANNELS
    }

    pub(crate) fn push(&mut self, samples: &[f32]) -> Result<(), AudioError> {
        unsafe {
            let f = self.frame;
            ff::av_frame_unref(f);
            (*f).nb_samples = (samples.len() / CHANNELS) as i32;
            (*f).format = ff::AVSampleFormat::AV_SAMPLE_FMT_FLT as i32;
            (*f).sample_rate = self.rate as i32;
            ff::av_channel_layout_default(&mut (*f).ch_layout, CHANNELS as i32);
            check("av_frame_get_buffer", ff::av_frame_get_buffer(f, 0))?;
            std::ptr::copy_nonoverlapping(samples.as_ptr(), (*f).data[0] as *mut f32, samples.len());
            check("av_buffersrc_add_frame_flags", ff::av_buffersrc_add_frame_flags(self.src, f, 0))?;
            loop {
                let r = ff::av_buffersink_get_frame(self.sink, f);
                if r == ff::AVERROR(ff::EAGAIN) || r == ff::AVERROR_EOF {
                    return Ok(());
                }
                check("av_buffersink_get_frame", r)?;
                let n = (*f).nb_samples as usize;
                if (*f).format == ff::AVSampleFormat::AV_SAMPLE_FMT_FLTP as i32 {
                    let (l, r) = (std::slice::from_raw_parts((*f).data[0] as *const f32, n), std::slice::from_raw_parts((*f).data[1] as *const f32, n));
                    for i in 0..n {
                        self.out.extend([l[i], r[i]]);
                    }
                } else {
                    self.out.extend(std::slice::from_raw_parts((*f).data[0] as *const f32, n * CHANNELS));
                }
                ff::av_frame_unref(f);
            }
        }
    }

    /// Move `out.len() / 2` frames out (they must be available).
    pub(crate) fn take(&mut self, out: &mut [f32]) {
        let n = out.len().min(self.out.len());
        for (o, v) in out.iter_mut().zip(self.out.drain(..n)) {
            *o = v;
        }
    }
}

impl Drop for Tempo {
    fn drop(&mut self) {
        unsafe {
            ff::av_frame_free(&mut self.frame);
            ff::avfilter_graph_free(&mut self.graph);
        }
    }
}
