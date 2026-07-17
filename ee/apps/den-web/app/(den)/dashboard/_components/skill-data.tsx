"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRequestError, requestJson } from "../../_lib/den-flow";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";

export type DenOrgSkillVisibility = "org" | "public" | null;

export type DenOrgSkill = {
  id: string;
  title: string;
  description: string | null;
  skillText: string;
  shared: DenOrgSkillVisibility;
  canManage: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

export type SaveOrgSkillInput = {
  skillText: string;
  shared: DenOrgSkillVisibility;
};

export type UpdateOrgSkillInput = SaveOrgSkillInput & {
  skillId: string;
};

export const skillQueryKeys = {
  all: ["skills"],
  list: (orgId?: string | null) => ["skills", "list", orgId ?? "none"],
};

function requireOrgId(orgId: string | null) {
  if (!orgId) {
    throw new Error("Select an organization before managing skills.");
  }
  return orgId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseVisibility(value: unknown): DenOrgSkillVisibility {
  return value === "org" || value === "public" ? value : null;
}

function parseSkill(value: unknown): DenOrgSkill | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = asString(value.id);
  const title = asString(value.title);
  const skillText = asString(value.skillText);

  if (!id || !title || skillText === null) {
    return null;
  }

  return {
    id,
    title,
    skillText,
    description: asString(value.description),
    shared: parseVisibility(value.shared),
    canManage: value.canManage === true,
    createdAt: asString(value.createdAt),
    updatedAt: asString(value.updatedAt),
  };
}

function parseSkillList(payload: unknown): DenOrgSkill[] {
  if (!isRecord(payload) || !Array.isArray(payload.skills)) {
    return [];
  }

  return payload.skills.flatMap((entry) => {
    const skill = parseSkill(entry);
    return skill ? [skill] : [];
  });
}

function parseSkillPayload(payload: unknown): DenOrgSkill | null {
  if (!isRecord(payload)) {
    return null;
  }

  return parseSkill(payload.skill);
}

export function useOrgSkills() {
  const { orgId } = useOrgDashboard();

  return useQuery({
    enabled: Boolean(orgId),
    queryKey: skillQueryKeys.list(orgId),
    queryFn: async () => {
      requireOrgId(orgId);
      const { response, payload } = await requestJson("/v1/skills", { method: "GET" }, 15000);
      if (!response.ok) {
        throw getRequestError(payload, response, `Failed to load skills (${response.status}).`);
      }
      return parseSkillList(payload);
    },
  });
}

export function useCreateOrgSkill() {
  const queryClient = useQueryClient();
  const { orgId, runReauthableAction } = useOrgDashboard();

  return useMutation({
    mutationFn: async (input: SaveOrgSkillInput): Promise<DenOrgSkill> => {
      requireOrgId(orgId);
      let created: DenOrgSkill | null = null;

      await runReauthableAction("create-skill", async () => {
        const { response, payload } = await requestJson(
          "/v1/skills",
          { method: "POST", body: JSON.stringify(input) },
          20000,
        );
        if (!response.ok) {
          throw getRequestError(payload, response, `Failed to create skill (${response.status}).`);
        }
        created = parseSkillPayload(payload);
      });

      if (!created) {
        throw new Error("Skill create response was incomplete.");
      }
      return created;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: skillQueryKeys.all });
    },
  });
}

export function useUpdateOrgSkill() {
  const queryClient = useQueryClient();
  const { orgId, runReauthableAction } = useOrgDashboard();

  return useMutation({
    mutationFn: async (input: UpdateOrgSkillInput): Promise<DenOrgSkill> => {
      requireOrgId(orgId);
      let updated: DenOrgSkill | null = null;

      await runReauthableAction("update-skill", async () => {
        const { response, payload } = await requestJson(
          `/v1/skills/${encodeURIComponent(input.skillId)}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              skillText: input.skillText,
              shared: input.shared,
            }),
          },
          20000,
        );
        if (!response.ok) {
          throw getRequestError(payload, response, `Failed to update skill (${response.status}).`);
        }
        updated = parseSkillPayload(payload);
      });

      if (!updated) {
        throw new Error("Skill update response was incomplete.");
      }
      return updated;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: skillQueryKeys.all });
    },
  });
}

export function useDeleteOrgSkill() {
  const queryClient = useQueryClient();
  const { orgId, runReauthableAction } = useOrgDashboard();

  return useMutation({
    mutationFn: async (skillId: string): Promise<string> => {
      requireOrgId(orgId);

      await runReauthableAction("delete-skill", async () => {
        const { response, payload } = await requestJson(
          `/v1/skills/${encodeURIComponent(skillId)}`,
          { method: "DELETE" },
          15000,
        );
        if (response.status !== 204 && !response.ok) {
          throw getRequestError(payload, response, `Failed to delete skill (${response.status}).`);
        }
      });

      return skillId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: skillQueryKeys.all });
    },
  });
}
