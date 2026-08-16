import { useSearchParams } from "react-router";
import { ecommerceBusinessById } from "../features/ecommerce/businesses/businessRegistry.js";
import { EcommerceBusinessSession } from "./EcommerceBusinessSession.jsx";

export function EcommerceDesignView() {
  const [params] = useSearchParams();
  const business = ecommerceBusinessById(params.get("tool") || "shoot");
  return (
    <EcommerceBusinessSession
      key={business.stateNamespace}
      businessId={business.id}
    />
  );
}
