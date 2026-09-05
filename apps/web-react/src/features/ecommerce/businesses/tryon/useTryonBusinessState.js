import { useState } from "react";
import {
  TRYON_DEFAULT_LENS_ID,
  TRYON_DEFAULT_LIGHT_ID,
} from "../../ecommerceTools.js";

export function useTryonBusinessState() {
  const [tryonSlots, setTryonSlots] = useState({
    garment: null,
    model: null,
    scene: null,
  });
  const [tryonUploadNotice, setTryonUploadNoticeState] = useState("");
  const [tryonDraftReady, setTryonDraftReady] = useState(false);
  const [tryonStarting, setTryonStarting] = useState(false);
  const [featuredTryonModelId, setFeaturedTryonModelId] = useState("");
  const [tryonModelBusy, setTryonModelBusy] = useState(false);
  const [featuredTryonSceneId, setFeaturedTryonSceneId] = useState("");
  const [tryonSceneBusy, setTryonSceneBusy] = useState(false);
  const [tryonModelCatalog, setTryonModelCatalog] = useState([]);
  const [tryonSceneCatalog, setTryonSceneCatalog] = useState([]);
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
