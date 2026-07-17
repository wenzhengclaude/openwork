"use client";

import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { FileText, Plus, Search, Trash2, Upload } from "lucide-react";
import { DashboardPageTemplate } from "../../_components/ui/dashboard-page-template";
import { DenButton } from "../../_components/ui/button";
import { DenInput } from "../../_components/ui/input";
import { DenSelect } from "../../_components/ui/select";
import { DenTextarea } from "../../_components/ui/textarea";
import {
  type DenOrgSkill,
  type DenOrgSkillVisibility,
  useCreateOrgSkill,
  useDeleteOrgSkill,
  useOrgSkills,
  useUpdateOrgSkill,
} from "./skill-data";

const DEFAULT_SKILL_TEXT = `---
name: company-runbook
description: Use the company runbook when answering internal workflow questions.
---

Use this skill when a user asks about an internal workflow, approval path, or operating procedure.

Check the current workspace files first. Prefer official company documentation when it is available.`;

type EditorMode =
  | { kind: "closed" }
  | { kind: "create" }
  | { kind: "edit"; skill: DenOrgSkill };

function formatSkillTimestamp(value: string | null) {
  if (!value) {
    return "Recently updated";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Recently updated";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function visibilityLabel(value: DenOrgSkillVisibility) {
  if (value === "public") {
    return "Public";
  }
  if (value === "org") {
    return "Organization";
  }
  return "Private";
}

function getSkillSearchText(skill: DenOrgSkill) {
  return `${skill.title}\n${skill.description ?? ""}\n${skill.skillText}`.toLowerCase();
}

export function SkillsScreen() {
  const { data: skills = [], isLoading, error } = useOrgSkills();
  const createSkill = useCreateOrgSkill();
  const updateSkill = useUpdateOrgSkill();
  const deleteSkill = useDeleteOrgSkill();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [editor, setEditor] = useState<EditorMode>({ kind: "closed" });
  const [skillText, setSkillText] = useState(DEFAULT_SKILL_TEXT);
  const [shared, setShared] = useState<DenOrgSkillVisibility>("org");
  const [query, setQuery] = useState("");
  const [pageError, setPageError] = useState<string | null>(null);
  const [pageSuccess, setPageSuccess] = useState<string | null>(null);

  const filteredSkills = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return skills;
    }
    return skills.filter((skill) => getSkillSearchText(skill).includes(normalized));
  }, [query, skills]);

  const editorOpen = editor.kind !== "closed";
  const saving = createSkill.isPending || updateSkill.isPending;
  const deleting = deleteSkill.isPending;

  function openCreateEditor() {
    setEditor({ kind: "create" });
    setSkillText(DEFAULT_SKILL_TEXT);
    setShared("org");
    setPageError(null);
    setPageSuccess(null);
  }

  function openEditEditor(skill: DenOrgSkill) {
    setEditor({ kind: "edit", skill });
    setSkillText(skill.skillText);
    setShared(skill.shared);
    setPageError(null);
    setPageSuccess(null);
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) {
      return;
    }

    try {
      setSkillText(await file.text());
      setPageError(null);
    } catch (readError) {
      setPageError(readError instanceof Error ? readError.message : "Failed to read the selected file.");
    }
  }

  async function saveSkill() {
    const trimmed = skillText.trim();
    setPageError(null);
    setPageSuccess(null);

    if (!trimmed) {
      setPageError("Paste or upload a SKILL.md file first.");
      return;
    }

    try {
      if (editor.kind === "edit") {
        const updated = await updateSkill.mutateAsync({
          skillId: editor.skill.id,
          skillText: trimmed,
          shared,
        });
        setEditor({ kind: "edit", skill: updated });
        setPageSuccess(`Updated ${updated.title}.`);
      } else {
        const created = await createSkill.mutateAsync({ skillText: trimmed, shared });
        setEditor({ kind: "edit", skill: created });
        setPageSuccess(`Published ${created.title}.`);
      }
    } catch (saveError) {
      setPageError(saveError instanceof Error ? saveError.message : "Failed to save skill.");
    }
  }

  async function removeSkill(skill: DenOrgSkill) {
    if (!confirm(`Delete ${skill.title}?`)) {
      return;
    }

    setPageError(null);
    setPageSuccess(null);
    try {
      await deleteSkill.mutateAsync(skill.id);
      if (editor.kind === "edit" && editor.skill.id === skill.id) {
        setEditor({ kind: "closed" });
      }
      setPageSuccess(`Deleted ${skill.title}.`);
    } catch (deleteError) {
      setPageError(deleteError instanceof Error ? deleteError.message : "Failed to delete skill.");
    }
  }

  return (
    <DashboardPageTemplate
      icon={FileText}
      badgeLabel="Admin"
      title="Skills"
      description="Upload and maintain organization skills. Shared skills appear in Open One for teammates to add to their current workspace."
      colors={["#ECFEFF", "#164E63", "#0891B2", "#A5F3FC"]}
    >
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="sm:w-[320px]">
          <DenInput
            type="search"
            icon={Search}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search skills..."
          />
        </div>
        <DenButton type="button" icon={Plus} onClick={openCreateEditor}>
          New skill
        </DenButton>
      </div>

      {pageError ? (
        <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-[14px] text-red-700">
          {pageError}
        </div>
      ) : null}
      {pageSuccess ? (
        <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-[14px] text-emerald-700">
          {pageSuccess}
        </div>
      ) : null}
      {error ? (
        <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-[14px] text-red-700">
          {error instanceof Error ? error.message : "Failed to load skills."}
        </div>
      ) : null}

      {editorOpen ? (
        <section className="mb-6 rounded-2xl border border-gray-100 bg-white p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-[15px] font-semibold text-gray-950">
                {editor.kind === "edit" ? editor.skill.title : "New skill"}
              </h2>
              <p className="mt-1 text-[13px] leading-5 text-gray-500">
                {editor.kind === "edit" ? "Update the published markdown and save a new version." : "Upload or paste a SKILL.md file."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".md,.markdown,text/markdown,text/plain"
                className="hidden"
                onChange={(event) => void handleFileChange(event)}
              />
              <DenButton
                type="button"
                variant="secondary"
                icon={Upload}
                onClick={() => fileInputRef.current?.click()}
                disabled={saving}
              >
                Upload
              </DenButton>
              <DenButton type="button" variant="secondary" onClick={() => setEditor({ kind: "closed" })} disabled={saving}>
                Close
              </DenButton>
              <DenButton type="button" onClick={() => void saveSkill()} loading={saving}>
                Save
              </DenButton>
            </div>
          </div>

          <div className="mt-5 grid gap-4">
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-medium text-gray-700">Visibility</span>
              <DenSelect
                value={shared ?? "private"}
                onChange={(event) => {
                  const value = event.target.value;
                  setShared(value === "public" ? "public" : value === "private" ? null : "org");
                }}
                disabled={saving}
              >
                <option value="org">Organization</option>
                <option value="public">Public</option>
                <option value="private">Private</option>
              </DenSelect>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[12px] font-medium text-gray-700">SKILL.md</span>
              <DenTextarea
                value={skillText}
                onChange={(event) => setSkillText(event.target.value)}
                rows={18}
                disabled={saving}
                className="font-mono text-[12.5px] leading-6"
                spellCheck={false}
              />
            </label>
          </div>
        </section>
      ) : null}

      {isLoading ? (
        <div className="rounded-2xl border border-gray-100 bg-white px-6 py-10 text-[14px] text-gray-500">
          Loading skills...
        </div>
      ) : filteredSkills.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-6 py-12 text-center">
          <p className="text-[15px] font-semibold tracking-[-0.02em] text-gray-900">
            {skills.length === 0 ? "No organization skills yet" : "No skills match that search"}
          </p>
          <p className="mx-auto mt-2 max-w-[520px] text-[13px] leading-6 text-gray-500">
            {skills.length === 0
              ? "Create one here and it will appear in Open One after the desktop app refreshes its team catalog."
              : "Try a different search term."}
          </p>
          {skills.length === 0 ? (
            <div className="mt-5 flex justify-center">
              <DenButton type="button" icon={Plus} onClick={openCreateEditor}>
                New skill
              </DenButton>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-3">
          {filteredSkills.map((skill) => (
            <article key={skill.id} className="rounded-2xl border border-gray-100 bg-white px-5 py-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-[15px] font-semibold tracking-[-0.01em] text-gray-950">
                      {skill.title}
                    </h2>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
                      {visibilityLabel(skill.shared)}
                    </span>
                  </div>
                  {skill.description ? (
                    <p className="mt-1 line-clamp-2 text-[13px] leading-6 text-gray-500">
                      {skill.description}
                    </p>
                  ) : null}
                  <p className="mt-3 text-[11.5px] text-gray-400">
                    Updated {formatSkillTimestamp(skill.updatedAt)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {skill.canManage ? (
                    <>
                      <DenButton type="button" variant="secondary" size="sm" onClick={() => openEditEditor(skill)}>
                        Edit
                      </DenButton>
                      <DenButton
                        type="button"
                        variant="destructive"
                        size="sm"
                        icon={Trash2}
                        onClick={() => void removeSkill(skill)}
                        disabled={deleting}
                      >
                        Delete
                      </DenButton>
                    </>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </DashboardPageTemplate>
  );
}
