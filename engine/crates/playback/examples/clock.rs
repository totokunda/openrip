//! Check the audio master clock against wall time (silently): `clock <project.json>`
use std::time::{Duration, Instant};
use openrip_model::{Micros, Project};
use openrip_playback::Player;
fn main() {
    let p: Project = serde_json::from_str(&std::fs::read_to_string(std::env::args().nth(1).unwrap()).unwrap()).unwrap();
    let player = Player::new(p).expect("audio output");
    player.set_volume(0.0);
    let start = Micros(3_500_000);
    let t0 = Instant::now();
    player.play(start);
    let mut samples = Vec::new();
    while t0.elapsed() < Duration::from_secs(2) {
        std::thread::sleep(Duration::from_millis(100));
        samples.push((t0.elapsed().as_secs_f64(), (player.position().0 - start.0) as f64 / 1e6));
    }
    for (wall, clock) in &samples {
        println!("wall {wall:.3} s  clock +{clock:.3} s  drift {:+.1} ms", (clock - wall) * 1000.0);
    }
    let (w0, c0) = samples[2];
    let (w1, c1) = *samples.last().unwrap();
    println!("rate {:.4} (clock seconds per wall second), device {} Hz", (c1 - c0) / (w1 - w0), player.sample_rate());
}
