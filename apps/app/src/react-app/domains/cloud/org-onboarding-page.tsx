/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRightIcon,
  Check,
  CheckCircle2,
  CircleAlert,
  Sparkles,
} from "lucide-react";
import {
  BuildingOffice2Icon,
  CloudIcon,
  Square3Stack3DIcon,
} from "@heroicons/react/24/solid";

import {
  createDenClient,
  readDenSettings,
  resolveDenBaseUrls,
  writeDenSettings,
  type DenOrgLlmProvider,
  type DenOrgMarketplace,
  type DenOrgSummary,
} from "@/app/lib/den";
import { getDesktopBootstrapConfig } from "@/app/lib/desktop";
import { usePlatform } from "../../kernel/platform";
import { useBootState } from "../../shell/boot-state";
import { resolveModelDisplayName, resolveProviderDisplayName } from "@/app/utils";
import { ProviderIcon } from "../../design-system/provider-icon";
import { writeStoredDefaultModel } from "../../kernel/model-config";
import { orgOnboardingVisibilityEvent } from "../../shell/reload-coordinator";
import {
  Page,
  PageBackground,
  PageContainer,
  PageContent,
  PageDescription,
  PageFooter,
  PageHeader,
  PageLoading,
  PageLoadingDescription,
  PageLoadingSpinner,
  PageTitle,
  PageTitlebarRegion,
} from "@/components/page";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import { ScrollArea, ScrollAreaViewport } from "@/components/ui/scroll-area";
import { Field, FieldLabel, FieldTitle } from "@/components/ui/field"
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group"
import { t } from "@/i18n";
import { useOrgListWindow } from "./use-org-list-window";

const RELOAD_AFTER_ONBOARDING_KEY = "openwork.reloadAfterOrgOnboarding";

function useDenClient() {
  const settings = useMemo(() => readDenSettings(), []);
  const authToken = settings.authToken ?? "";
  const denClient = useMemo(
    () =>
      createDenClient({
        baseUrl: settings.baseUrl,
        token: settings.authToken,
      }),
    [authToken, settings.baseUrl],
  );

  return {
    authToken,
    denClient,
    orgId: settings.activeOrgId ?? "",
    orgName: settings.activeOrgName ?? "",
    settings,
  };
}

/**
 * When an agent-first install prepared this desktop, read the non-secret
 * prepared summary (org + first skill) so the onboarding payoff can greet the
 * user with "Setup complete" instead of a generic resource list.
 */
type PreparedBootstrapSummary = {
  orgName: string;
  skillTitle: string;
  claimLinks: Array<{ id: string; role: string; url: string; expiresAt: string }>;
};

function usePreparedBootstrap() {
  const [prepared, setPrepared] = useState<PreparedBootstrapSummary | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getDesktopBootstrapConfig()
      .then((config) => {
        if (cancelled) return;
        if (config.prepared?.skillTitle) {
          setPrepared({
            orgName: config.prepared.orgName || "",
            skillTitle: config.prepared.skillTitle,
            claimLinks: config.claimLinks ?? [],
          });
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return prepared;
}

const FIRST_TASK_IDEA_KEYS = [
  "den.org_onboarding_task_idea_downloads",
  "den.org_onboarding_task_idea_screenshots",
  "den.org_onboarding_task_idea_intro_email",
];

function PreparedWorkspacePage({ prepared }: { prepared: PreparedBootstrapSummary }) {
  const navigate = useNavigate();
  const platform = usePlatform();
  const ownerClaim = prepared.claimLinks.find((link) => link.role === "owner") ?? prepared.claimLinks[0] ?? null;

  const startFirstTask = () => {
    navigate("/session", { replace: true });
    // Drop the cursor into the composer so the user can type their first task.
    [0, 120, 320, 600].forEach((delay) =>
      window.setTimeout(() => window.dispatchEvent(new Event("openwork:focusPrompt")), delay),
    );
  };

  return (
    <Page>
      <PageBackground />
      <PageTitlebarRegion />
      <PageContainer>
        <PageHeader>
          <div
            data-openwork-prepared="true"
            data-openwork-provisional="true"
            className="mx-auto flex w-fit items-center gap-2 rounded-full border border-green-6/30 bg-green-2/30 px-3 py-1 text-xs font-semibold text-green-11"
          >
            <CheckCircle2 className="size-3.5" />
            {t("den.org_onboarding_setup_complete_ready")}
          </div>
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl border border-dls-border bg-dls-hover">
            <BuildingOffice2Icon className="size-7 text-foreground" />
          </div>
          <PageTitle>{prepared.orgName || t("den.org_onboarding_your_workspace")}</PageTitle>
          <div
            data-openwork-prepared-skill={prepared.skillTitle}
            className="mx-auto flex w-fit items-center gap-2 rounded-xl border border-border bg-dls-hover px-3 py-2 text-sm text-foreground"
          >
            <Sparkles className="size-4 text-foreground/60" />
            {t("den.org_onboarding_first_skill_ready")}
            <span className="font-semibold">{prepared.skillTitle}</span>
          </div>
          <PageDescription>
            {t("den.org_onboarding_prepared_desc")}
          </PageDescription>
        </PageHeader>

        <PageContent>
          <div className="mx-auto flex w-full max-w-md flex-col gap-4">
            <div className="rounded-2xl border border-border bg-dls-hover/40 p-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground/60">
                {t("den.org_onboarding_try_asking")}
              </div>
              <ul className="flex flex-col gap-2">
                {FIRST_TASK_IDEA_KEYS.map((ideaKey) => (
                  <li
                    key={ideaKey}
                    className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                  >
                    {t(ideaKey)}
                  </li>
                ))}
              </ul>
            </div>

            <Button size="lg" className="w-full" onClick={startFirstTask}>
              {t("den.org_onboarding_open_workspace")}
              <ArrowRight data-icon="inline-end" />
            </Button>

            {ownerClaim ? (
              <button
                type="button"
                onClick={() => platform.openLink(ownerClaim.url)}
                className="inline-flex items-center justify-center gap-1.5 text-sm text-foreground/70 transition-colors hover:text-foreground"
              >
                {t("den.org_onboarding_claim_workspace")}
                <ArrowUpRightIcon className="size-3.5" />
              </button>
            ) : null}
          </div>
        </PageContent>
      </PageContainer>
    </Page>
  );
}

function markProvidersSeen(providers: DenOrgLlmProvider[]) {
  if (providers.length === 0) return;

  try {
    const raw = window.localStorage.getItem("openwork.seenProviderIds");
    const existing: string[] = raw ? JSON.parse(raw) : [];
    const ids = new Set(existing);
    for (const provider of providers) ids.add(provider.id);
    window.localStorage.setItem("openwork.seenProviderIds", JSON.stringify([...ids]));
  } catch {}
}

/**
 * Full-screen onboarding page shown after sign-in + org selection.
 * Fetches all org resources (providers, marketplaces, skills)
 * and shows them so the user knows what their org provides.
 *
 * Route: /onboarding
 */
export function OrgOnboardingPage() {
  const navigate = useNavigate();
  const { authToken, denClient, orgId, settings } = useDenClient();
  const { markRouteReady } = useBootState();
  const prepared = usePreparedBootstrap();
  const [hasSelectedOrganization, setHasSelectedOrganization] = useState(false);
  
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(orgOnboardingVisibilityEvent, { detail: { visible: true } }));
    return () => {
      window.dispatchEvent(new CustomEvent(orgOnboardingVisibilityEvent, { detail: { visible: false } }));
    };
  }, []);

  useEffect(() => {
    markRouteReady();
  }, [markRouteReady]);

  useEffect(() => {
    if (!authToken && !prepared) {
      navigate("/session", { replace: true });
    }
  }, [authToken, navigate, prepared]);

  const { data, error, isPending } = useQuery({
    queryKey: ["den-org-onboarding", settings.baseUrl, "orgs"],
    enabled: Boolean(authToken),
    queryFn: () => denClient.listOrgs(),
  });

  if (!authToken) {
    return prepared ? <PreparedWorkspacePage prepared={prepared} /> : null;
  }

  if (isPending) {
    return (
      <Page>
        <PageBackground />
        <PageTitlebarRegion />
        <PageContainer>
          <PageHeader>
            <div className="mx-auto flex size-14 items-center justify-center rounded-2xl border border-dls-border bg-dls-hover">
              <BuildingOffice2Icon className="size-7 text-foreground" />
            </div>
            <PageTitle>{t("den.org_onboarding_your_org_title")}</PageTitle>
          </PageHeader>
          <PageContent>
            <PageLoading>
              <PageLoadingSpinner />
              <PageLoadingDescription>{t("den.org_onboarding_loading_orgs")}</PageLoadingDescription>
            </PageLoading>
          </PageContent>
        </PageContainer>
      </Page>
    );
  }

  if (error) {
    return (
      <Page>
        <PageBackground />
        <PageTitlebarRegion />
        <PageContainer>
          <PageHeader>
            <div className="mx-auto flex size-14 items-center justify-center rounded-2xl border border-dls-border bg-dls-hover">
              <BuildingOffice2Icon className="size-7 text-foreground" />
            </div>
            <PageTitle>{t("den.org_onboarding_choose_title")}</PageTitle>
            <Alert variant="destructive">
              <CircleAlert />
              <AlertDescription>
                {error instanceof Error ? error.message : t("den.org_onboarding_load_error")}
              </AlertDescription>
            </Alert>
          </PageHeader>
        </PageContainer>
      </Page>
    );
  }

  if ((data?.orgs.length ?? 0) > 0 && !hasSelectedOrganization) {
    return (
      <OrganizationSelectionPage
        orgs={data.orgs}
        defaultOrganization={
          data.orgs.find((org) => org.id === orgId) ??
          data.orgs[0]
        }
        onContinue={() => setHasSelectedOrganization(true)}
      />
    );
  }

  return <ResourceSelectionPage />;
}

export function ResourceSelectionPage() {
  const navigate = useNavigate();
  const platform = usePlatform();
  const { markRouteReady } = useBootState();
  const { authToken, denClient, orgId, orgName, settings } = useDenClient();

  const prepared = usePreparedBootstrap();

  const [selectedDefault, setSelectedDefault] = useState<{
    providerId: string;
    modelId: string;
    label: string;
  } | null>(null);

  // Redirect if no auth or no org — can't show onboarding without them
  useEffect(() => {
    markRouteReady();
  }, [markRouteReady]);

  useEffect(() => {
    if (!authToken || !orgId) {
      navigate("/session", { replace: true });
    }
  }, [authToken, navigate, orgId]);

  const { providers, marketplaces, loading, error } = useQueries({
    queries: [
      {
        queryKey: ["den-org-onboarding", settings.baseUrl, orgId, "providers"],
        enabled: Boolean(authToken && orgId),
        queryFn: () => denClient.listOrgLlmProviders(orgId),
      },
      {
        queryKey: ["den-org-onboarding", settings.baseUrl, orgId, "marketplaces"],
        enabled: Boolean(authToken && orgId),
        queryFn: () => denClient.listOrgMarketplaces(orgId),
      },
    ],
    combine: ([providersQuery, marketplacesQuery]) => ({
      providers: providersQuery.data ?? [],
      marketplaces: marketplacesQuery.data ?? [],
      loading: providersQuery.isPending || marketplacesQuery.isPending,
      error: providersQuery.error?.message ?? marketplacesQuery.error?.message ?? null,
    }),
  });

  const handleContinue = useCallback(() => {
    // If user picked a default model, write it
    if (selectedDefault) {
      writeStoredDefaultModel({
        providerID: selectedDefault.providerId,
        modelID: selectedDefault.modelId,
      });
    }
    // Mark all providers shown on this page as "seen" so the global
    // toast doesn't re-fire for them on the next sync interval.
    markProvidersSeen(providers);
    if (providers.length > 0) {
      try {
        window.localStorage.setItem(RELOAD_AFTER_ONBOARDING_KEY, "1");
      } catch {}
    }
    navigate("/session", { replace: true });
  }, [navigate, providers, selectedDefault]);

  const totalModels = providers.reduce((sum, provider) => sum + provider.models.length, 0);
  const hasResources = providers.length > 0 || marketplaces.length > 0;

  return (
    <Page>
      <PageBackground />
      <PageTitlebarRegion />

      <PageContainer>
        {/* Header */}
        <PageHeader>
          {prepared ? (
            <div
              data-openwork-prepared="true"
              className="mx-auto flex w-fit items-center gap-2 rounded-full border border-green-6/30 bg-green-2/30 px-3 py-1 text-xs font-semibold text-green-11"
            >
              <CheckCircle2 className="size-3.5" />
              {t("den.org_onboarding_setup_complete_prepared")}
            </div>
          ) : null}
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl border border-dls-border bg-dls-hover">
            <BuildingOffice2Icon className="size-7 text-foreground" />
          </div>
          <PageTitle>
            {orgName || t("den.org_onboarding_your_org_title")}
          </PageTitle>
          {prepared ? (
            <div
              data-openwork-prepared-skill={prepared.skillTitle}
              className="mx-auto flex w-fit items-center gap-2 rounded-xl border border-border bg-dls-hover px-3 py-2 text-sm text-foreground"
            >
              <Sparkles className="size-4 text-foreground/60" />
              {t("den.org_onboarding_first_skill_ready")}
              <span className="font-semibold">{prepared.skillTitle}</span>
            </div>
          ) : null}
          {loading ? (
            null
          ) : error ? (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : hasResources ? (
            <PageDescription>
              {t("den.org_onboarding_resources_desc")}
            </PageDescription>
          ) : null}
        </PageHeader>

        {loading ? (
          <PageContent>
            <PageLoading>
              <PageLoadingSpinner />
              <PageLoadingDescription>{t("den.org_onboarding_loading_resources")}</PageLoadingDescription>
            </PageLoading>
          </PageContent>
        ) : !hasResources ? (
          <PageContent>
            <Empty className="h-fit flex-none">
              <EmptyHeader>
                <EmptyTitle>{t("den.org_onboarding_empty_resources_title")}</EmptyTitle>
                <EmptyDescription>
                  {t("den.org_onboarding_empty_resources_desc")}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button
                  variant="outline"
                  onClick={() => platform.openLink(resolveDenBaseUrls(settings.baseUrl).baseUrl)}
                >
                  {t("den.org_onboarding_open_cloud")}
                  <ArrowUpRightIcon data-icon="inline-end" />
                </Button>
              </EmptyContent>
            </Empty>
          </PageContent>
        ) : (
          <PageContent>
            <ScrollArea className="px-2.5">
              <ScrollAreaViewport>
                <Accordion
                  multiple
                  className="rounded-2xl border border-border bg-transparent shadow-none before:hidden"
                >
                  {/* AI Providers */}
                  {providers.length > 0 ? (
                    <Section
                      icon={<CloudIcon className="size-5 text-foreground/60" />}
                      title={t("den.org_onboarding_ai_providers_title")}
                      description={t("den.org_onboarding_ai_providers_desc")}
                      count={
                        totalModels === 1
                          ? t("den.org_onboarding_model_count_one")
                          : t("den.org_onboarding_model_count_other", { value: totalModels })
                      }
                    >
                      {providers.map((provider) => (
                        <ProviderCard
                          key={provider.id}
                          provider={provider}
                          selectedDefault={selectedDefault}
                          onSelectDefault={setSelectedDefault}
                        />
                      ))}
                    </Section>
                  ) : null}

                  {/* Marketplaces */}
                  {marketplaces.length > 0 ? (
                    <Section
                      icon={<Square3Stack3DIcon className="size-5 text-foreground/60" />}
                      title={t("den.org_onboarding_marketplaces_title")}
                      description={t("den.org_onboarding_marketplaces_desc")}
                      count={
                        marketplaces.length === 1
                          ? t("den.org_onboarding_marketplace_count_one")
                          : t("den.org_onboarding_marketplace_count_other", { value: marketplaces.length })
                      }
                    >
                      {marketplaces.map((mp) => (
                        <MarketplaceCard key={mp.id} marketplace={mp} />
                      ))}
                    </Section>
                  ) : null}

                </Accordion>
              </ScrollAreaViewport>
            </ScrollArea>
            {/* Selected default indicator */}
            {selectedDefault ? (
              <div className="rounded-xl border border-green-6/30 bg-green-2/30 px-4 py-3 text-center text-sm text-green-11">
                <Check size={14} className="mr-1 inline" />
                {t("den.org_onboarding_default_model_set", { model: selectedDefault.label })}
              </div>
            ) : null}
          </PageContent>
        )}

        <PageFooter>
          {/* Footer hint */}
          {!loading && hasResources ? (
            <p className="text-center text-xs text-muted-foreground text-balance leading-relaxed tracking-wide">
              {t("den.org_onboarding_footer_hint")}
            </p>
          ) : null}
          <Button
            className="w-fit"
            type="button"
            size="lg"
            onClick={handleContinue}
            disabled={loading}
          >
            {hasResources ? t("den.org_onboarding_continue_workspace") : t("common.next")}
            <ArrowRight data-icon="inline-end" />
          </Button>
        </PageFooter>
      </PageContainer>
    </Page>
  );
}

interface MarketplaceCardProps {
  marketplace: DenOrgMarketplace;
}

function MarketplaceCard({ marketplace }: MarketplaceCardProps) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border px-3 py-3 -mx-2">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">{marketplace.name}</div>
        {marketplace.description ? (
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {marketplace.description}
          </div>
        ) : null}
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">
        {marketplace.pluginCount === 1
          ? t("den.org_onboarding_plugin_count_one")
          : t("den.org_onboarding_plugin_count_other", { value: marketplace.pluginCount })}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Section wrapper                                                    */
/* ------------------------------------------------------------------ */

interface SectionProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  count: string;
  children: React.ReactNode;
}

function Section({ icon, title, description, count, children }: SectionProps) {
  return (
    <AccordionItem value={title}>
      <AccordionTrigger className="items-center px-5 py-4 gap-4.75 hover:no-underline">
        {icon}

        <div className="min-w-0 flex-1 flex flex-col gap-1">
          <h3 className="flex items-center gap-2 font-medium tracking-wide">
            {title}
            <span className="text-muted-foreground text-xs uppercase">{count}</span>
          </h3>
          <p className="text-sm font-normal normal-case tracking-normal text-muted-foreground">
            {description}
          </p>
        </div>
      </AccordionTrigger>
      <AccordionContent className="space-y-2 pb-2">
        {children}
      </AccordionContent>
    </AccordionItem>
  );
}

/* ------------------------------------------------------------------ */
/*  Provider card with "Use as default" option                         */
/* ------------------------------------------------------------------ */

interface ProviderCardProps {
  provider: DenOrgLlmProvider;
  selectedDefault: { providerId: string; modelId: string } | null;
  onSelectDefault: (value: {
    providerId: string;
    modelId: string;
    label: string;
  } | null) => void;
}

function ProviderCard({ provider, selectedDefault, onSelectDefault }: ProviderCardProps) {
  // The local provider ID matches the cloud provider's org-level ID
  const localProviderId = provider.id.trim();
  const firstModel = provider.models[0] ?? null;
  const isSelected = selectedDefault?.providerId === localProviderId;

  const handleUseAsDefault = () => {
    if (!firstModel) return;
    if (isSelected) {
      onSelectDefault(null);
    } else {
      onSelectDefault({
        providerId: localProviderId,
        modelId: firstModel.id,
        label: `${resolveProviderDisplayName(provider.name || provider.providerId)} · ${firstModel.name || resolveModelDisplayName(firstModel.id)}`,
      });
    }
  };

  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-3 transition-colors -mx-2",
        isSelected ? "border-green-6" : "border-border",
      )}
    >
      <div className="flex items-center gap-4.5">
        <ProviderIcon
          providerId={provider.providerId}
          providerName={provider.name}
          size={20}
          className="text-foreground"
        />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">
            {resolveProviderDisplayName(provider.name || provider.providerId)}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {provider.models.length === 1
              ? t("den.org_onboarding_model_count_one")
              : t("den.org_onboarding_model_count_other", { value: provider.models.length })}
          </div>
        </div>
        {firstModel ? (
          <button
            type="button"
            className={cn(
              "shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors",
              isSelected
                ? "bg-green-3 text-green-11"
                : "border border-border text-muted-foreground hover:bg-hover hover:text-foreground",
            )}
            onClick={handleUseAsDefault}
          >
            {isSelected ? t("den.org_onboarding_default_badge") : t("den.org_onboarding_use_as_default")}
          </button>
        ) : (
          <Check size={16} className="shrink-0 text-green-11" />
        )}
      </div>
      {provider.models.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {provider.models.slice(0, 5).map((model) => (
            <span
              key={model.id}
              className="inline-flex items-center rounded-md border border-border bg-hover px-2 py-0.5 font-mono text-xs text-muted-foreground"
            >
              {model.name || resolveModelDisplayName(model.id)}
            </span>
          ))}
          {provider.models.length > 5 ? (
            <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs text-muted-foreground">
              {t("den.org_onboarding_more_models", { value: provider.models.length - 5 })}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

interface OrganizationSelectionPageProps {
  orgs: DenOrgSummary[];
  defaultOrganization: DenOrgSummary;
  onContinue: () => void;
}

function OrganizationSelectionPage({
  orgs,
  defaultOrganization,
  onContinue,
}: OrganizationSelectionPageProps) {
  const { authToken, denClient, settings } = useDenClient();
  const [selected, setSelected] = useState(defaultOrganization);
  const { error, isPending, mutate } = useMutation({
    mutationFn: async (nextOrg: DenOrgSummary) => {
      await denClient.setActiveOrganization({ organizationId: nextOrg.id });
      return nextOrg;
    },
    onSuccess: (nextOrg) => {
      writeDenSettings({
        ...settings,
        authToken: authToken || null,
        activeOrgId: nextOrg.id,
        activeOrgSlug: nextOrg.slug,
        activeOrgName: nextOrg.name,
      });

      onContinue();
    },
  });

  return (
    <Page>
      <PageBackground />
      <PageTitlebarRegion />
      <PageContainer>
        <PageHeader>
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl border border-dls-border bg-dls-hover">
            <BuildingOffice2Icon className="size-7 text-foreground" />
          </div>
          <PageTitle>{t("den.org_onboarding_choose_title")}</PageTitle>
          {error ? (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertDescription>
                {error instanceof Error ? error.message : t("den.org_onboarding_select_error")}
              </AlertDescription>
            </Alert>
          ) : (
            <PageDescription>
              {t("den.org_onboarding_select_desc")}
            </PageDescription>
          )}
        </PageHeader>

        <PageContent>
          <OrganizationList
            orgs={orgs}
            value={selected}
            onValueChange={setSelected}
          />
        </PageContent>

        <PageFooter>
          <Button
            className="w-fit"
            type="button"
            size="lg"
            onClick={() => mutate(selected)}
            disabled={isPending}
          >
            {isPending ? t("den.org_onboarding_connecting") : t("den.org_onboarding_continue_org")}
            <ArrowRight data-icon="inline-end" />
          </Button>
        </PageFooter>
      </PageContainer>
    </Page>
  );
}

interface OrganizationListProps {
  orgs: DenOrgSummary[];
  value: DenOrgSummary;
  onValueChange: (value: DenOrgSummary) => void;
}

export function OrganizationList({ orgs, value, onValueChange }: OrganizationListProps) {
  const { filtered, query, showMore, updateQuery, visible } = useOrgListWindow(orgs);
  const hasMore = visible.length < filtered.length;

  return (
    <div className="flex flex-col gap-3">
      {orgs.length > 10 ? (
        <Input
          aria-label={t("den.org_onboarding_search_label")}
          placeholder={t("den.org_onboarding_search_placeholder")}
          value={query}
          onChange={(event) => updateQuery(event.target.value)}
        />
      ) : null}

      <RadioGroup
        value={value.id}
        onValueChange={(nextOrgId) => {
          const nextOrg = orgs.find((org) => org.id === nextOrgId);
          if (nextOrg) onValueChange(nextOrg);
        }}
        aria-label={t("den.org_onboarding_organizations_label")}
      >
        {visible.map((org) => {
          const fieldId = `organization-${org.id}`;

          return (
            <FieldLabel
              key={org.id}
              htmlFor={fieldId}
              className="p-0! transition-colors hover:bg-input/10"
            >
              <Field orientation="horizontal">
                <FieldTitle className="flex min-w-0 items-center gap-4">
                  <BuildingOffice2Icon className="size-6 shrink-0 text-muted-foreground" />
                  <div className="flex min-w-0 flex-col items-start">
                    <span className="max-w-full truncate text-sm font-semibold">
                      {org.name}
                    </span>
                    <span className="max-w-full truncate text-muted-foreground text-xs">
                      {org.slug}
                    </span>
                  </div>
                </FieldTitle>
                <RadioGroupItem
                  value={org.id}
                  id={fieldId}
                  className="group-hover/field-label:bg-foreground/25"
                />
              </Field>
            </FieldLabel>
          );
        })}
      </RadioGroup>

      {filtered.length === 0 && query.trim() ? (
        <div className="text-sm text-muted-foreground">
          {t("den.org_onboarding_no_matches")}
        </div>
      ) : null}

      {hasMore ? (
        <div className="flex flex-col items-start gap-2">
          <Button type="button" variant="outline" size="sm" onClick={showMore}>
            {t("den.org_onboarding_show_more")}
          </Button>
          <div className="text-xs text-muted-foreground">
            {t("den.org_onboarding_showing_count", {
              visible: visible.length,
              total: filtered.length,
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}
