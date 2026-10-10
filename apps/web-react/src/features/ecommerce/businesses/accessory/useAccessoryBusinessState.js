import { useRef, useState } from "react";
import {
  ACCESSORY_DEFAULT_CATEGORY_ID,
  ACCESSORY_DEFAULT_CROP_ID,
  ACCESSORY_DEFAULT_MATERIAL_ID,
  ACCESSORY_DEFAULT_OCCLUSION_ID,
  ACCESSORY_DEFAULT_PACK_ID,
  ACCESSORY_DEFAULT_SCALE_ID,
  ACCESSORY_DEFAULT_STYLE_ID,
  emptyAccessorySlots,
} from "../../accessory/accessoryCommerce.js";

export function useAccessoryBusinessState() {
  const [accessoryCategory, setAccessoryCategory] = useState(
    ACCESSORY_DEFAULT_CATEGORY_ID,
  );
  const [accessoryPack, setAccessoryPack] = useState(ACCESSORY_DEFAULT_PACK_ID);
  const [accessoryMaterial, setAccessoryMaterial] = useState(
    ACCESSORY_DEFAULT_MATERIAL_ID,
  );
  const [accessoryScale, setAccessoryScale] = useState(
    ACCESSORY_DEFAULT_SCALE_ID,
  );
  const [accessorySizeMm, setAccessorySizeMm] = useState("");
  const [accessoryOcclusion, setAccessoryOcclusion] = useState(
    ACCESSORY_DEFAULT_OCCLUSION_ID,
  );
  const [accessoryCrop, setAccessoryCrop] = useState(ACCESSORY_DEFAULT_CROP_ID);
  const [accessoryStyle, setAccessoryStyle] = useState(
    ACCESSORY_DEFAULT_STYLE_ID,
  );
  const [accessorySku, setAccessorySku] = useState("");
  const [accessorySlots, setAccessorySlots] = useState(emptyAccessorySlots);
  const [accessoryDraftReady, setAccessoryDraftReady] = useState(false);
  const [accessoryActionBusy, setAccessoryActionBusy] = useState(false);
  const [accessoryNotice, setAccessoryNotice] = useState("");
  const [accessoryPreview, setAccessoryPreview] = useState(null);
  const accessoryUploadRoleRef = useRef("product");

  return {
    accessoryCategory,
    setAccessoryCategory,
    accessoryPack,
    setAccessoryPack,
    accessoryMaterial,
    setAccessoryMaterial,
    accessoryScale,
    setAccessoryScale,
    accessorySizeMm,
    setAccessorySizeMm,
    accessoryOcclusion,
    setAccessoryOcclusion,
    accessoryCrop,
    setAccessoryCrop,
    accessoryStyle,
    setAccessoryStyle,
    accessorySku,
    setAccessorySku,
    accessorySlots,
    setAccessorySlots,
    accessoryDraftReady,
    setAccessoryDraftReady,
    accessoryActionBusy,
    setAccessoryActionBusy,
    accessoryNotice,
    setAccessoryNotice,
    accessoryPreview,
    setAccessoryPreview,
    accessoryUploadRoleRef,
  };
}
