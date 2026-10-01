import { useState } from "react";
import {
  HANDHELD_DEFAULT_CROP_ID,
  HANDHELD_DEFAULT_PACK_ID,
  HANDHELD_DEFAULT_PLATFORM_ID,
} from "../../ecommerceTools.js";
import { HANDHELD_MODEL_CATALOG, HANDHELD_SCENE_CATALOG } from "./catalog.js";

export function useHandheldBusinessState() {
  const [handheldUploadNotice, setHandheldUploadNoticeState] = useState("");
  const [handheldStarting, setHandheldStarting] = useState(false);
  const [handheldGuideOpen, setHandheldGuideOpen] = useState(false);
  const [handheldPreview, setHandheldPreview] = useState(null);
  const [handheldActionBusy, setHandheldActionBusy] = useState(false);
  const [handheldProjectId, setHandheldProjectId] = useState("");
  const [handheldRetryingByIndex, setHandheldRetryingByIndex] = useState({});
  const [handheldModelBusy, setHandheldModelBusy] = useState(false);
  const [handheldSceneBusy, setHandheldSceneBusy] = useState(false);
  const [handheldSlots, setHandheldSlots] = useState({
    product: null,
    model: null,
    scene: null,
    layout: null,
    // 同一件商品的其他角度（可选），减少 AI 臆造看不见的面
    productSide: null,
    productBack: null,
    productLogo: null,
  });
  const [handheldModelCatalog, setHandheldModelCatalog] = useState(
    HANDHELD_MODEL_CATALOG,
  );
  const [handheldHandCatalog, setHandheldHandCatalog] = useState([]);
  const [handheldSceneCatalog, setHandheldSceneCatalog] = useState(
    HANDHELD_SCENE_CATALOG,
  );
  const [handheldDraftReady, setHandheldDraftReady] = useState(false);
  const [featuredHandheldModelId, setFeaturedHandheldModelId] = useState(
    HANDHELD_MODEL_CATALOG[0].id,
  );
  const [featuredHandheldHandId, setFeaturedHandheldHandId] = useState("");
  const [featuredHandheldSceneId, setFeaturedHandheldSceneId] = useState(
    HANDHELD_SCENE_CATALOG[0].id,
  );
  const [handheldPose, setHandheldPose] = useState("");
  const [handheldStyle, setHandheldStyle] = useState("");
  const [handheldCrop, setHandheldCrop] = useState(HANDHELD_DEFAULT_CROP_ID);
  const [handheldPack, setHandheldPack] = useState(HANDHELD_DEFAULT_PACK_ID);
  const [handheldHand, setHandheldHand] = useState("");
  const [handheldLanguage, setHandheldLanguage] = useState("");
  const [handheldAnnotations, setHandheldAnnotations] = useState([]);
  const [handheldCategory, setHandheldCategory] = useState("");
  const [handheldPlatform, setHandheldPlatform] = useState(
    HANDHELD_DEFAULT_PLATFORM_ID,
  );
  const [handheldLens, setHandheldLens] = useState("");
  const [handheldLight, setHandheldLight] = useState("");
  const [handheldCamera, setHandheldCamera] = useState("");
  const [handheldDepth, setHandheldDepth] = useState("");
  const [handheldFocus, setHandheldFocus] = useState("");
  const [handheldMaterialInteraction, setHandheldMaterialInteraction] =
    useState("");
  const [handheldPhotoPreset, setHandheldPhotoPreset] = useState("");
  const [handheldPackState, setHandheldPackState] = useState("");
  const [handheldArchitecture, setHandheldArchitecture] = useState("");
  const [handheldPromptEdits, setHandheldPromptEdits] = useState({});
  const [handheldSku, setHandheldSku] = useState("");
  // 实物尺寸（毫米）；auto=true 表示按品类预填，换品类时跟着换
  const [handheldSizeMm, setHandheldSizeMm] = useState({
    length: "",
    width: "",
    height: "",
    auto: true,
  });
  // 「只改这张」：{ index, token }，token 变化时只重画该张
  const [handheldShotRegen, setHandheldShotRegen] = useState(null);

  return {
    handheldUploadNotice,
    setHandheldUploadNoticeState,
    handheldStarting,
    setHandheldStarting,
    handheldGuideOpen,
    setHandheldGuideOpen,
    handheldPreview,
    setHandheldPreview,
    handheldActionBusy,
    setHandheldActionBusy,
    handheldProjectId,
    setHandheldProjectId,
    handheldRetryingByIndex,
    setHandheldRetryingByIndex,
    handheldModelBusy,
    setHandheldModelBusy,
    handheldSceneBusy,
    setHandheldSceneBusy,
    handheldSlots,
    setHandheldSlots,
    handheldModelCatalog,
    setHandheldModelCatalog,
    handheldHandCatalog,
    setHandheldHandCatalog,
    handheldSceneCatalog,
    setHandheldSceneCatalog,
    handheldDraftReady,
    setHandheldDraftReady,
    featuredHandheldModelId,
    setFeaturedHandheldModelId,
    featuredHandheldHandId,
    setFeaturedHandheldHandId,
    featuredHandheldSceneId,
    setFeaturedHandheldSceneId,
    handheldPose,
    setHandheldPose,
    handheldStyle,
    setHandheldStyle,
    handheldCrop,
    setHandheldCrop,
    handheldPack,
    setHandheldPack,
    handheldHand,
    setHandheldHand,
    handheldLanguage,
    setHandheldLanguage,
    handheldAnnotations,
    setHandheldAnnotations,
    handheldCategory,
    setHandheldCategory,
    handheldPlatform,
    setHandheldPlatform,
    handheldLens,
    setHandheldLens,
    handheldLight,
    setHandheldLight,
    handheldCamera,
    setHandheldCamera,
    handheldDepth,
    setHandheldDepth,
    handheldFocus,
    setHandheldFocus,
    handheldMaterialInteraction,
    setHandheldMaterialInteraction,
    handheldPhotoPreset,
    setHandheldPhotoPreset,
    handheldPackState,
    setHandheldPackState,
    handheldArchitecture,
    setHandheldArchitecture,
    handheldPromptEdits,
    setHandheldPromptEdits,
    handheldSku,
    setHandheldSku,
    handheldSizeMm,
    setHandheldSizeMm,
    handheldShotRegen,
    setHandheldShotRegen,
  };
}
