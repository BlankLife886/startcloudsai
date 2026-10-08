import { reactive } from "vue";
import { request } from "@/request";
import type { ImageParamProfile } from "./providerTypes";

interface ProfilesResponse {
  profiles: ImageParamProfile[];
  customized: boolean;
  droppable: string[];
}

/** Shared image parameter profiles, loaded once per page. */
export const imageParamProfiles = reactive({
  profiles: [] as ImageParamProfile[],
  customized: false,
  droppable: [] as string[],
  loaded: false,
});

let pending: Promise<void> | null = null;

function apply(result: ProfilesResponse) {
  imageParamProfiles.profiles = result.profiles || [];
  imageParamProfiles.customized = result.customized;
  imageParamProfiles.droppable = result.droppable || [];
  imageParamProfiles.loaded = true;
}

export function loadImageParamProfiles(force = false): Promise<void> {
  if (imageParamProfiles.loaded && !force) return Promise.resolve();
  if (!pending || force) {
    pending = request<ProfilesResponse>("/api/v1/admin/model-config/image-param-profiles", { silent: true })
      .then(apply)
      .catch(() => {
        imageParamProfiles.loaded = false;
      })
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}

export async function saveImageParamProfiles(profiles: ImageParamProfile[]) {
  apply(await request<ProfilesResponse>("/api/v1/admin/model-config/image-param-profiles", { method: "PUT", body: { profiles } }));
}

export async function resetImageParamProfiles() {
  apply(await request<ProfilesResponse>("/api/v1/admin/model-config/image-param-profiles", { method: "DELETE" }));
}

export function findImageParamProfile(id?: string) {
  return id ? imageParamProfiles.profiles.find((profile) => profile.id === id) : undefined;
}
