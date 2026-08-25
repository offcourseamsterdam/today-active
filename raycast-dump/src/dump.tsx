import {
  Form,
  ActionPanel,
  Action,
  showToast,
  Toast,
  getPreferenceValues,
  popToRoot,
} from "@raycast/api";
import { useState } from "react";
import fetch from "node-fetch";

interface Preferences {
  apiUrl: string;
  secret: string;
}

type Tag = "urgent-work" | "work" | "personal";

export default function Dump() {
  const { apiUrl, secret } = getPreferenceValues<Preferences>();
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(values: { text: string; tag: Tag }) {
    const text = values.text.trim();
    if (!text) {
      showToast({ style: Toast.Style.Failure, title: "Tekst is verplicht" });
      return;
    }

    setIsLoading(true);

    try {
      const base = apiUrl.replace(/\/$/, "");
      const response = await fetch(`${base}/api/write-away`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, tag: values.tag, secret }),
      });

      if (!response.ok) {
        const err = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `HTTP ${response.status}`);
      }

      const isUrgent = values.tag === "urgent-work";

      await showToast({
        style: Toast.Style.Success,
        title: "Weggeschreven ✓",
        message: isUrgent ? "Losse taak aangemaakt." : undefined,
      });

      popToRoot();
    } catch (err) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Mislukt",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Form
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Dump & Klaar" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextArea
        id="text"
        title="Schrijf het weg"
        placeholder="Afleiding of frustratie... schrijf het gewoon op."
        autoFocus
      />
      <Form.Dropdown id="tag" title="Type" defaultValue="work">
        <Form.Dropdown.Item value="work" title="Werk" />
        <Form.Dropdown.Item value="urgent-work" title="⚡ Urgent werk — maakt ook een taak aan" />
        <Form.Dropdown.Item value="personal" title="Persoonlijk" />
      </Form.Dropdown>
    </Form>
  );
}
