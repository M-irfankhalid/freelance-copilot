import { AppError } from "../../lib/errors.js";
import { getProfile } from "../profile/profile.service.js";
import { buildProfileBrief } from "../profile/profile-brief.js";

export async function generateProfileBrief(
  userId: string,
  _preferredModel?: string
): Promise<string> {
  const profile = getProfile(userId);
  if (!profile) {
    throw new AppError(404, "NOT_FOUND", "Profile not found");
  }
  return buildProfileBrief(profile);
}
