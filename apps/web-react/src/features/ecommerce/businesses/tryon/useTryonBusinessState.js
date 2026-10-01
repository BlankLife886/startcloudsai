import { useState } from "react";
import {
  TRYON_DEFAULT_LENS_ID,
  TRYON_DEFAULT_LIGHT_ID,
} from "../../ecommerceTools.js";

export function useTryonBusinessState() {
  const [tryonSlots, setTryonSlots] = useState({
    garment: null,
    bottom: null,
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
  // 出图套餐：single 单张主图 / set 上架 4 连拍（主图、侧面、场景、面料）
  const [tryonPack, setTryonPack] = useState("single");
  // 背景：scene 用场景图 / white 纯白棚拍（不发送场景图）
  const [tryonBackdrop, setTryonBackdrop] = useState("scene");
  // 上传质检提示：{ [role]: string[] }
  const [tryonSlotHints, setTryonSlotHints] = useState({});
  // 最近一次替换/移除，可在几秒内撤销：{ role, previous, message }
  const [tryonUndo, setTryonUndo] = useState(null);
  // 批量试衣：主服装之外追加的服装，每件用同一模特/场景各出一组
  const [tryonBatchGarments, setTryonBatchGarments] = useState([]);
  // 上传服装后的 AI 品类识别：{ status: idle|busy|done|error, apparel, label, file }
  const [tryonGarmentDetect, setTryonGarmentDetect] = useState({
    status: "idle",
  });

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
    tryonGarmentDetect,
    setTryonGarmentDetect,
    tryonPack,
    setTryonPack,
    tryonBackdrop,
    setTryonBackdrop,
    tryonSlotHints,
    setTryonSlotHints,
    tryonUndo,
    setTryonUndo,
    tryonBatchGarments,
    setTryonBatchGarments,
    setTryonPreview,
  };
}
