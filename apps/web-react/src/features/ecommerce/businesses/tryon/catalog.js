import modelEastAsianFemale from "@react/legacy-static/assets/ecommerce/models/tryon-model-east-asian-female.jpg";
import modelEastAsianMale from "@react/legacy-static/assets/ecommerce/models/tryon-model-east-asian-male.jpg";
import modelEuropeanFemale from "@react/legacy-static/assets/ecommerce/models/tryon-model-european-female.jpg";
import modelEuropeanMale from "@react/legacy-static/assets/ecommerce/models/tryon-model-european-male.jpg";
import modelSouthAsianFemale from "@react/legacy-static/assets/ecommerce/models/tryon-model-south-asian-female.jpg";
import modelUnspecified from "@react/legacy-static/assets/ecommerce/models/tryon-model-unspecified.jpg";
import sceneBeach from "@react/legacy-static/assets/ecommerce/scenes/tryon-scene-beach.jpg";
import sceneCafe from "@react/legacy-static/assets/ecommerce/scenes/tryon-scene-cafe.jpg";
import sceneGallery from "@react/legacy-static/assets/ecommerce/scenes/tryon-scene-gallery.jpg";
import sceneHome from "@react/legacy-static/assets/ecommerce/scenes/tryon-scene-home.jpg";
import sceneLawn from "@react/legacy-static/assets/ecommerce/scenes/tryon-scene-lawn.jpg";
import sceneStreet from "@react/legacy-static/assets/ecommerce/scenes/tryon-scene-street.jpg";
import sceneStudio from "@react/legacy-static/assets/ecommerce/scenes/tryon-scene-studio.jpg";

export const TRYON_MODEL_CATALOG = Object.freeze([
  { id: "east-asian-female", label: "东亚女性", image: modelEastAsianFemale },
  { id: "east-asian-male", label: "东亚男性", image: modelEastAsianMale },
  { id: "european-female", label: "欧美女性", image: modelEuropeanFemale },
  { id: "european-male", label: "欧美男性", image: modelEuropeanMale },
  { id: "south-asian-female", label: "南亚女性", image: modelSouthAsianFemale },
  { id: "unspecified", label: "不限定人群", image: modelUnspecified },
]);

export const TRYON_SCENE_CATALOG = Object.freeze([
  { id: "studio", label: "纯色棚拍", image: sceneStudio },
  { id: "street", label: "都市街头", image: sceneStreet },
  { id: "cafe", label: "街角咖啡", image: sceneCafe },
  { id: "lawn", label: "自然草坪", image: sceneLawn },
  { id: "beach", label: "度假海滩", image: sceneBeach },
  { id: "home", label: "温馨居家", image: sceneHome },
  { id: "gallery", label: "艺术展馆", image: sceneGallery },
]);
