import { webApi } from "@/services/axios";
import type { ApiBody } from "@/services/api-types";

export type MemberRole = "viewer" | "editor";

export interface FolderMember {
  userId: string;
  name: string;
  email: string;
  role: MemberRole | "owner";
  status: "pending" | "accepted";
  invitedAt: string | null;
}

export interface FolderInvite {
  folderId: string;
  folderName: string;
  ownerName: string;
  role: MemberRole;
  invitedAt: string;
}

export type NotificationKind =
  | "folder-invite"
  | "invite-accepted"
  | "invite-declined"
  | "role-changed"
  | "member-removed"
  | "member-left"
  | "folder-deleted";

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  actorName: string;
  folderId: string | null;
  folderName: string;
  role: string | null;
  read: boolean;
  createdAt: string;
}

/** The owner first, then members (pending invites only for the owner). */
export async function getFolderMembers(folderId: string) {
  const res = await webApi.get(`/folders/${folderId}/members`);
  return res.data.data as FolderMember[];
}

export async function inviteToFolder(folderId: string, body: ApiBody<"InviteMemberDto">) {
  const res = await webApi.post(`/folders/${folderId}/members`, body);
  return res.data.data as FolderMember;
}

export async function changeMemberRole(folderId: string, userId: string, role: MemberRole) {
  const body: ApiBody<"ChangeRoleDto"> = { role };
  await webApi.patch(`/folders/${folderId}/members/${userId}`, body);
}

/** Remove a member, or withdraw an invite. */
export async function removeMember(folderId: string, userId: string) {
  await webApi.delete(`/folders/${folderId}/members/${userId}`);
}

export async function leaveFolder(folderId: string) {
  await webApi.post(`/folders/${folderId}/leave`);
}

export async function answerInvite(folderId: string, accept: boolean) {
  await webApi.post(`/folders/${folderId}/invite/${accept ? "accept" : "decline"}`);
}

export async function getInvites() {
  const res = await webApi.get("/shares/invites");
  return res.data.data as FolderInvite[];
}

export async function getNotifications() {
  const res = await webApi.get("/notifications");
  return res.data.data as { notifications: AppNotification[]; unread: number };
}

/** Mark one notification read, or every one (id left out). */
export async function markNotificationsRead(id?: string) {
  const body: ApiBody<"MarkReadDto"> = id ? { id } : {};
  await webApi.post("/notifications/read", body);
}
