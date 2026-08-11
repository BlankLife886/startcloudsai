import { useState } from "react";
import "@legacy/components/layout/NavMusicPlayer.vue?react-style";

export function MusicPlayer() {
  const [open, setOpen] = useState(false);
  return (
    <div className={`nav-music-player${open ? " open" : ""}`} onClick={(event) => event.stopPropagation()}>
      <div className="nav-music-player__compact">
        <button type="button" className="nav-music-player__summary" aria-expanded={open} aria-haspopup="dialog" aria-label="音乐播放器：添加本地歌曲" title="添加本地歌曲" onClick={() => setOpen((value) => !value)}>
          <span className="nav-music-player__disc tone-violet" aria-hidden="true"><i className="bi bi-music-note-beamed" /></span>
        </button>
        <button type="button" className="nav-music-player__quick-play" aria-label="播放音乐" title="播放">
          <span className="nav-music-player__play-orb" aria-hidden="true"><i className="bi bi-play-fill" /></span>
        </button>
      </div>
      {open && (
        <section className="nav-music-panel" data-tone="violet" role="dialog" aria-label="音乐播放器">
          <header className="nav-music-panel__head"><div className="nav-music-panel__brand"><span>本地播放器</span></div><button type="button" aria-label="关闭播放器" title="关闭" onClick={() => setOpen(false)}><i className="bi bi-x-lg" /></button></header>
          <button type="button" className="nav-music-empty"><i className="bi bi-file-earmark-music" /><strong>添加本地歌曲开始播放</strong><span>最多 20 首 · MP3 / AAC / FLAC / WAV</span></button>
        </section>
      )}
    </div>
  );
}
