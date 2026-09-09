import { HomeCoverImage } from "./HomeCoverImage";
import "./HomeToolArtwork.css";

const COVERS = {
  creation: "/sucai/studio-cover-t2i.webp",
  portrait: "/sucai/studio-cover-model.webp",
  product: "/sucai/studio-cover-ecom-create.webp",
  illustration: "/sucai/studio-cover-coloring.webp",
  game: "/sucai/studio-cover-game.webp",
};

function ArtPhoto({ cover, className = "" }) {
  return (
    <span className={`home-tool-art__photo ${className}`}>
      <HomeCoverImage src={COVERS[cover]} alt="" draggable={false} />
    </span>
  );
}

function Artwork({ itemId, Icon }) {
  switch (itemId) {
    case "skills":
      return (
        <>
          <ArtPhoto cover="illustration" className="home-tool-art__collection-back" />
          <ArtPhoto cover="portrait" className="home-tool-art__collection-middle" />
          <ArtPhoto cover="creation" className="home-tool-art__collection-front" />
          <span className="home-tool-art__collection-pin"><i /><i /><i /><i /></span>
        </>
      );
    case "psd-decompose":
      return (
        <span className="home-tool-art__layers">
          <span className="home-tool-art__layer home-tool-art__layer-back" />
          <span className="home-tool-art__layer home-tool-art__layer-middle"><i /><i /></span>
          <ArtPhoto cover="product" className="home-tool-art__layer home-tool-art__layer-front" />
        </span>
      );
    case "all-ai-tools":
      return (
        <span className="home-tool-art__matrix">
          <ArtPhoto cover="portrait" />
          <span className="home-tool-art__matrix-glyph home-tool-art__matrix-spark">
            <svg viewBox="0 0 40 40" fill="none"><path d="m20 8 3.3 8.7L32 20l-8.7 3.3L20 32l-3.3-8.7L8 20l8.7-3.3L20 8Z" /></svg>
          </span>
          <ArtPhoto cover="product" />
          <span className="home-tool-art__matrix-glyph home-tool-art__matrix-wave"><i /><i /><i /><i /><i /></span>
          <ArtPhoto cover="creation" />
          <span className="home-tool-art__matrix-glyph home-tool-art__matrix-crop"><i /></span>
        </span>
      );
    case "background-remove":
      return (
        <span className="home-tool-art__cutout">
          <span className="home-tool-art__cutout-object"><i /><b /></span>
          <span className="home-tool-art__selection"><i /><i /><i /><i /></span>
        </span>
      );
    case "image-compress":
      return (
        <>
          <ArtPhoto cover="creation" className="home-tool-art__compress-source" />
          <svg className="home-tool-art__compress-arrow" viewBox="0 0 32 24" fill="none">
            <path d="M3 12h23m-6-6 6 6-6 6" />
          </svg>
          <ArtPhoto cover="creation" className="home-tool-art__compress-result" />
        </>
      );
    case "puzzle":
      return (
        <span className="home-tool-art__collage">
          <ArtPhoto cover="portrait" />
          <ArtPhoto cover="creation" />
          <ArtPhoto cover="illustration" />
          <ArtPhoto cover="game" />
        </span>
      );
    default:
      return (
        <span className="home-tool-art__orbit">
          <span className="home-tool-art__orbit-ring" />
          <span className="home-tool-art__orbit-ring" />
          <span className="home-tool-art__orbit-core">{Icon ? <Icon size={25} strokeWidth={1.2} /> : <i />}</span>
          <i className="home-tool-art__orbit-node" />
          <i className="home-tool-art__orbit-node" />
        </span>
      );
  }
}

export function HomeToolArtwork({ itemId, Icon }) {
  return (
    <span className="home-tool-art" aria-hidden="true">
      <Artwork itemId={itemId} Icon={Icon} />
    </span>
  );
}
