import { useState } from "react";
import {
  TRYON_DEFAULT_LENS_ID,
  TRYON_DEFAULT_LIGHT_ID,
} from "../../ecommerceTools.js";
import { TRYON_MODEL_CATALOG, TRYON_SCENE_CATALOG } from "./catalog.js";

export function useTryonBusinessState() {
  const [tryonSlots, setTryonSlots] = useState({
    garment: null,
    model: null,
    scene: null,
  });
  const [tryonUploadNotice, setTryonUploadNoticeState] = useState("");
  const [tryonDraftReady, setTryonDraftReady] = useState(false);
  const [tryonStarting, setTryonStarting] = useState(false);
  const [featuredTryonModelId, setFeaturedTryonModelId] = useState(
    TRYON_MODEL_CATALOG[0].id,
  );
  const [tryonModelBusy, setTryonModelBusy] = useState(false);
  const [featuredTryonSceneId, setFeaturedTryonSceneId] = useState(
    TRYON_SCENE_CATALOG[0].id,
  );
  const [tryonSceneBusy, setTryonSceneBusy] = useState(false);
  const [tryonModelCatalog, setTryonModelCatalog] =
    useState(TRYON_MODEL_CATALOG);
  const [tryonSceneCatalog, setTryonSceneCatalog] =
    useState(TRYON_SCENE_CATALOG);
  const [tryonGarmentCatalog, setTryonGarmentCatalog] = useState([]);
  const [featuredTryonGarmentId, setFeaturedTryonGarmentId] = useState("");
  const [tryonGarmentBusy, setTryonGarmentBusy] = useState(false);
  const [tryonLens, setTryonLens] = useState(TRYON_DEFAULT_LENS_ID);
  const [tryonLight, setTryonLight] = useState(TRYON_DEFAULT_LIGHT_ID);
  const [tryonPreview, setTryonPreview] = useState(null);

  return {
    tryonSlots,
    setTryonSlots,
    tryonUploadNotice,
    setTryonUploadNoticeState,
    tryonDraftReady,
    setTryonDraftReady,
    tryonStarting,
    setTryonStarting,
    featuredTryonModelId,
    setFeaturedTryonModelId,
    tryonModelBusy,
    setTryonModelBusy,
    featuredTryonSceneId,
    setFeaturedTryonSceneId,
    tryonSceneBusy,
    setTryonSceneBusy,
    tryonModelCatalog,
    setTryonModelCatalog,
    tryonSceneCatalog,
    setTryonSceneCatalog,
    tryonGarmentCatalog,
    setTryonGarmentCatalog,
    featuredTryonGarmentId,
    setFeaturedTryonGarmentId,
    tryonGarmentBusy,
    setTryonGarmentBusy,
    tryonLens,
    setTryonLens,
    tryonLight,
    setTryonLight,
    tryonPreview,
    setTryonPreview,
  };
}
