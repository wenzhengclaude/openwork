"use client"

import {
  DescriptiveButton,
  DescriptiveButtonContent,
  DescriptiveButtonDescription,
  DescriptiveButtonIcon,
  DescriptiveButtonTitle,
} from "@/components/descriptive-button"
import { useMessageList } from "@/components/chat/message-list-provider"
import { cn } from "@/lib/utils"
import { useOrgRestrictions } from "@/react-app/domains/cloud/desktop-config-provider"
import { TaskSuggestionVisual, taskSuggestionButtonClass } from "./task-suggestion-visuals"

const CSV_PROMPT =
  "Create a sample CSV file with 20 rows of fake customer data (name, email, company, revenue). Then show me a summary of the data."

const BROWSER_PROMPT =
  "Open craigslist.org in the browser and search for couches for sale. Show me the top 5 results with prices."

const ORGANIZATION_PROMPT_TITLES = ["Organization prompt 1", "Organization prompt 2", "Organization prompt 3"]

interface TaskSuggestionsProps {
  className?: string
}

export function TaskSuggestions({ className }: TaskSuggestionsProps) {
  const { displaySuggestions, providerConnectedCount, dispatchAction, setPrompt } = useMessageList()
  const organizationPrompts = useOrgRestrictions().onboardingPrompts

  if (!displaySuggestions) {
    return null
  }

  const noProviders = providerConnectedCount === 0
  const hasOrganizationPrompts = organizationPrompts !== undefined

  return (
    <div className={cn("@container flex flex-col gap-4 pt-1", className)}>
      <p className="text-muted-foreground font-medium select-none">
        {noProviders
          ? "Connect a model provider to get started:"
          : hasOrganizationPrompts
            ? "Try one of your organization's prompts:"
            : "Try one of these:"}
      </p>
      <div className="grid min-w-0 gap-2 @lg:grid-cols-2 @2xl:grid-cols-3">
        {noProviders ? (
          <DescriptiveButton
            orientation="vertical"
            className={cn(taskSuggestionButtonClass, "border-blue-7/50 bg-blue-2/30 hover:bg-blue-3/40 @lg:col-span-2 @2xl:col-span-3")}
            onClick={() =>
              dispatchAction({
                target: "settings",
                action: "open",
                section: "providers",
              })
            }
          >
            <DescriptiveButtonIcon>
              <TaskSuggestionVisual kind="provider" />
            </DescriptiveButtonIcon>
            <DescriptiveButtonContent>
              <DescriptiveButtonTitle>Connect a model provider</DescriptiveButtonTitle>
              <DescriptiveButtonDescription>
                Add an API key for Anthropic, OpenAI, Google, or others
              </DescriptiveButtonDescription>
            </DescriptiveButtonContent>
          </DescriptiveButton>
        ) : null}

        {hasOrganizationPrompts ? (
          organizationPrompts.map((prompt, index) => (
            <DescriptiveButton
              key={`${index}-${prompt}`}
              orientation="vertical"
              className={taskSuggestionButtonClass}
              onClick={() => setPrompt(prompt)}
            >
              <DescriptiveButtonIcon>
                <TaskSuggestionVisual kind="prompt" />
              </DescriptiveButtonIcon>
              <DescriptiveButtonContent>
                <DescriptiveButtonTitle>{ORGANIZATION_PROMPT_TITLES[index] ?? "Organization prompt"}</DescriptiveButtonTitle>
                <DescriptiveButtonDescription>{prompt}</DescriptiveButtonDescription>
              </DescriptiveButtonContent>
            </DescriptiveButton>
          ))
        ) : (
          <>
            <DescriptiveButton orientation="vertical" className={taskSuggestionButtonClass} onClick={() => setPrompt(CSV_PROMPT)}>
              <DescriptiveButtonIcon>
                <TaskSuggestionVisual kind="csv" />
              </DescriptiveButtonIcon>
              <DescriptiveButtonContent>
                <DescriptiveButtonTitle>Edit a CSV</DescriptiveButtonTitle>
                <DescriptiveButtonDescription>Create a sample spreadsheet</DescriptiveButtonDescription>
              </DescriptiveButtonContent>
            </DescriptiveButton>

            <DescriptiveButton orientation="vertical" className={taskSuggestionButtonClass} onClick={() => setPrompt(BROWSER_PROMPT)}>
              <DescriptiveButtonIcon>
                <TaskSuggestionVisual kind="browser" />
              </DescriptiveButtonIcon>
              <DescriptiveButtonContent>
                <DescriptiveButtonTitle>Browse the web</DescriptiveButtonTitle>
                <DescriptiveButtonDescription>Search Craigslist for couches</DescriptiveButtonDescription>
              </DescriptiveButtonContent>
            </DescriptiveButton>

            <DescriptiveButton
              orientation="vertical"
              className={taskSuggestionButtonClass}
              onClick={() =>
                dispatchAction({
                  target: "settings",
                  action: "open",
                  section: "mcps",
                })
              }
            >
              <DescriptiveButtonIcon>
                <TaskSuggestionVisual kind="extension" />
              </DescriptiveButtonIcon>
              <DescriptiveButtonContent>
                <DescriptiveButtonTitle>Connect an extension</DescriptiveButtonTitle>
                <DescriptiveButtonDescription>Add MCPs and integrations</DescriptiveButtonDescription>
              </DescriptiveButtonContent>
            </DescriptiveButton>
          </>
        )}
      </div>
    </div>
  )
}
