/** @jsxImportSource react */
import { useMemo, useState } from "react";
import { Check, Loader2, RefreshCw, Server } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { OpenAiCompatibleProviderModelsResult } from "@/app/lib/openwork-server";
import {
  COMPANY_LOCAL_PROVIDER_NAME,
  companyLocalModelSupportsReasoning,
  type CompanyLocalProviderInstallInput,
  type CompanyLocalProviderModel,
} from "./company-local-provider";

type CompanyLocalProviderDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProbe: (input: { baseUrl: string; apiKey: string }) => Promise<OpenAiCompatibleProviderModelsResult>;
  onSave: (input: CompanyLocalProviderInstallInput) => Promise<void>;
};

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "无法连接模型服务。";
}

function formatTokenLimit(value: number | undefined): string | null {
  if (!value || !Number.isFinite(value) || value <= 0) return null;
  if (value >= 1_000_000) return `${Math.round(value / 1_000_000)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}

export function CompanyLocalProviderDialog(props: CompanyLocalProviderDialogProps) {
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [resolvedBaseUrl, setResolvedBaseUrl] = useState("");
  const [models, setModels] = useState<CompanyLocalProviderModel[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedModelIds = useMemo(() => new Set(selectedIds), [selectedIds]);
  const busy = discovering || saving;
  const selectedModels = useMemo(
    () => models.filter((model) => selectedModelIds.has(model.id)),
    [models, selectedModelIds],
  );

  const close = () => {
    if (busy) return;
    setApiKey("");
    setError(null);
    props.onOpenChange(false);
  };

  const discover = async () => {
    setDiscovering(true);
    setError(null);
    try {
      const result = await props.onProbe({ baseUrl, apiKey });
      setResolvedBaseUrl(result.baseUrl);
      setModels(result.models);
      setSelectedIds(result.models.map((model) => model.id));
    } catch (nextError) {
      setModels([]);
      setSelectedIds([]);
      setError(describeError(nextError));
    } finally {
      setDiscovering(false);
    }
  };

  const save = async () => {
    if (!resolvedBaseUrl || !apiKey.trim() || !selectedModels.length) return;
    setSaving(true);
    setError(null);
    try {
      await props.onSave({
        baseUrl: resolvedBaseUrl,
        apiKey,
        models: selectedModels,
      });
      close();
    } catch (nextError) {
      setError(describeError(nextError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Server className="size-4" />
            {COMPANY_LOCAL_PROVIDER_NAME}
          </DialogTitle>
          <DialogDescription>API 地址与密钥只保存在当前设备。</DialogDescription>
        </DialogHeader>

        <FieldSet className="min-h-0 gap-4 overflow-y-auto pr-1">
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor="company-local-provider-url">API 地址</FieldLabel>
              <Input
                id="company-local-provider-url"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.currentTarget.value)}
                placeholder="http://10.10.150.4:31080"
                autoComplete="url"
                disabled={busy}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="company-local-provider-key">API Key</FieldLabel>
              <Input
                id="company-local-provider-key"
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.currentTarget.value)}
                autoComplete="off"
                disabled={busy}
              />
            </Field>
          </FieldGroup>

          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-muted-foreground">
              {models.length ? `已发现 ${models.length} 个模型` : ""}
            </div>
            <Button type="button" variant="outline" onClick={() => void discover()} disabled={busy || !baseUrl.trim() || !apiKey.trim()}>
              {discovering ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              检测模型
            </Button>
          </div>

          {models.length ? (
            <div className="rounded-xl border border-border">
              <label className="flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2 text-sm font-medium">
                <Checkbox
                  checked={selectedIds.length === models.length}
                  onCheckedChange={(checked) => setSelectedIds(checked === true ? models.map((model) => model.id) : [])}
                  disabled={busy}
                />
                使用全部模型
              </label>
              <div className="max-h-56 overflow-y-auto py-1">
                {models.map((model) => (
                  <label key={model.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/40">
                    <Checkbox
                      checked={selectedModelIds.has(model.id)}
                      onCheckedChange={(checked) => {
                        setSelectedIds((current) => checked === true
                          ? Array.from(new Set([...current, model.id]))
                          : current.filter((id) => id !== model.id));
                      }}
                      disabled={busy}
                    />
                    <span className="min-w-0 truncate">{model.name}</span>
                    <span className="ml-auto flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                      {companyLocalModelSupportsReasoning(model) ? <span>推理</span> : null}
                      {formatTokenLimit(model.contextWindow) ? <span>{formatTokenLimit(model.contextWindow)} 上下文</span> : null}
                      {model.name !== model.id ? <span className="font-mono">{model.id}</span> : null}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {resolvedBaseUrl ? (
            <FieldDescription className="font-mono">{resolvedBaseUrl}</FieldDescription>
          ) : null}
        </FieldSet>

        <DialogFooter>
          <DialogClose disabled={busy} render={<Button variant="outline" disabled={busy} />}>
            取消
          </DialogClose>
          <Button type="button" onClick={() => void save()} disabled={busy || !resolvedBaseUrl || !apiKey.trim() || !selectedModels.length}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            保存到本机
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
