//! Path 2: a layer-backed NSView inside the Electron window whose CALayer shows
//! decoded IOSurfaces directly. Must be driven from the main (AppKit) thread,
//! which is where Electron's main-process JS runs on macOS.

use std::cell::RefCell;

use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::MainThreadMarker;
use objc2_app_kit::{NSView, NSWindowOrderingMode};
use objc2_foundation::{NSPoint, NSRect, NSSize};
use objc2_quartz_core::{kCAGravityResizeAspect, CALayer, CATransaction};

struct Overlay {
    parent: Retained<NSView>,
    view: Retained<NSView>,
    layer: Retained<CALayer>,
}

thread_local! {
    static OVERLAY: RefCell<Option<Overlay>> = const { RefCell::new(None) };
}

fn frame_in_parent(parent: &NSView, x: f64, y: f64, w: f64, h: f64) -> NSRect {
    let bounds = parent.bounds();
    let oy = if parent.isFlipped() { y } else { bounds.size.height - y - h };
    NSRect::new(NSPoint::new(x, oy), NSSize::new(w, h))
}

pub(crate) fn attach(handle: &[u8], x: f64, y: f64, w: f64, h: f64, below: bool) -> Result<(), String> {
    let mtm = MainThreadMarker::new().ok_or("overlay must run on the main thread")?;
    detach();
    let raw: [u8; 8] = handle.get(..8).ok_or("bad NSView handle")?.try_into().unwrap();
    let ptr = usize::from_ne_bytes(raw) as *mut NSView;
    let parent = unsafe { Retained::retain(ptr) }.ok_or("null NSView handle")?;

    let view = NSView::initWithFrame(mtm.alloc(), frame_in_parent(&parent, x, y, w, h));
    view.setWantsLayer(true);
    let layer = CALayer::new();
    unsafe {
        layer.setContentsGravity(kCAGravityResizeAspect);
    }
    view.setLayer(Some(&layer));
    if below {
        // Under the web contents: HTML can draw on top if the page is transparent there.
        parent.addSubview_positioned_relativeTo(&view, NSWindowOrderingMode::Below, None);
    } else {
        parent.addSubview(&view);
    }
    OVERLAY.with(|o| *o.borrow_mut() = Some(Overlay { parent, view, layer }));
    Ok(())
}

pub(crate) fn set_frame(x: f64, y: f64, w: f64, h: f64) {
    OVERLAY.with(|o| {
        if let Some(ov) = o.borrow().as_ref() {
            ov.view.setFrame(frame_in_parent(&ov.parent, x, y, w, h));
        }
    });
}

pub(crate) fn present(io_surface_ptr: usize) -> bool {
    OVERLAY.with(|o| {
        let Some(ov) = o.borrow().as_ref().map(|ov| ov.layer.clone()) else { return false };
        // IOSurfaceRef is toll-free bridged to an ObjC object, which CALayer accepts as contents.
        let surface = unsafe { &*(io_surface_ptr as *const AnyObject) };
        CATransaction::begin();
        CATransaction::setDisableActions(true);
        unsafe { ov.setContents(Some(surface)) };
        CATransaction::commit();
        true
    })
}

pub(crate) fn detach() {
    OVERLAY.with(|o| {
        if let Some(ov) = o.borrow_mut().take() {
            ov.view.removeFromSuperview();
        }
    });
}
