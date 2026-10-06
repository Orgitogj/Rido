import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import {
  ActionButton,
  Chip,
  Field,
  KeyValue,
  Notice,
  Section,
  shortId,
  when,
} from "@/components/admin/ui";
import { useOperator } from "@/lib/adminApi";
import {
  APPLICATION_STATUS,
  DOCUMENT_LABELS,
  DOCUMENT_STATUS,
} from "@/lib/driverVerification";
import { ApiRequestError, useApi, useApiQuery } from "@/lib/fetch";

import type { AdminDriverDetail } from "@/shared/contracts";
import type { VehicleCategoryAdmin } from "@/shared/vehicleCategory";

type Action =
  "approve" | "request_changes" | "reject" | "suspend" | "reinstate";

type DocDecision = { decision: "accept" | "reject"; note: string };

const ACTIONS: {
  action: Action;
  title: string;
  from: AdminDriverDetail["status"][];
  tone: "primary" | "danger" | "neutral";
}[] = [
  {
    action: "approve",
    title: "Approve",
    from: ["submitted", "approved"],
    tone: "primary",
  },
  {
    action: "request_changes",
    title: "Request changes",
    from: ["submitted"],
    tone: "neutral",
  },
  {
    action: "reject",
    title: "Reject",
    from: ["submitted", "changes_requested"],
    tone: "danger",
  },
  { action: "suspend", title: "Suspend", from: ["approved"], tone: "danger" },
  {
    action: "reinstate",
    title: "Reinstate",
    from: ["suspended"],
    tone: "primary",
  },
];

const DriverApplication = () => {
  const { id } = useLocalSearchParams<{ id: string }>();
  const operator = useOperator();
  const allowed = operator?.permissions.includes("verify") ?? false;
  const request = useApi();
  const query = useApiQuery<AdminDriverDetail>(
    allowed ? `/api/admin/drivers/${id}` : null,
  );
  const [reason, setReason] = useState("");
  const [applicantMessage, setApplicantMessage] = useState("");
  const [decisions, setDecisions] = useState<Record<string, DocDecision>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    tone: "error" | "success" | "info";
    text: string;
  } | null>(null);
  const d = query.data;
  const categories = useApiQuery<VehicleCategoryAdmin[]>(
    allowed ? "/api/admin/vehicle-categories" : null,
  );
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const currentCategories = (d?.categories ?? [])
    .map((c) => c.id)
    .sort()
    .join(",");

  useEffect(() => {
    setCategoryIds(currentCategories ? currentCategories.split(",") : []);
  }, [currentCategories]);

  const toggleCategory = (categoryId: string) =>
    setCategoryIds((prev) =>
      prev.includes(categoryId)
        ? prev.filter((c) => c !== categoryId)
        : [...prev, categoryId],
    );

  const saveCategories = async () => {
    if (!d) return;
    setBusy(true);
    setMessage(null);
    try {
      await request(`/api/admin/drivers/${id}/categories`, {
        body: {
          categoryIds,
          reason: reason.trim(),
          expectedVersion: d.version,
        },
      });
      setReason("");
      setMessage({ tone: "success", text: "Vehicle categories updated." });
    } catch (e) {
      setMessage({
        tone: "error",
        text: e instanceof ApiRequestError ? e.message : "Couldn't save.",
      });
    } finally {
      setBusy(false);
      query.refetch();
    }
  };

  const view = async (documentId: string) => {
    setMessage(null);
    try {
      const access = await request<{ url: string; expiresAt: string }>(
        `/api/admin/drivers/${id}/documents/${documentId}/access`,
        { method: "POST" },
      );
      if (typeof window !== "undefined") {
        window.open(access.url, "_blank", "noopener,noreferrer");
      }
      setMessage({
        tone: "info",
        text: "Opened in a new tab. The link stops working after 60 seconds and this access was recorded.",
      });
    } catch (e) {
      setMessage({
        tone: "error",
        text:
          e instanceof ApiRequestError
            ? e.message
            : "Couldn't open the document.",
      });
    }
  };

  const decide = async (action: Action) => {
    if (!d) return;
    setBusy(true);
    setMessage(null);
    try {
      await request(`/api/admin/drivers/${id}/decision`, {
        body: {
          action,
          reason: reason.trim(),
          ...(applicantMessage.trim()
            ? { applicantMessage: applicantMessage.trim() }
            : {}),
          expectedVersion: d.version,
          ...(action === "approve" ? { categoryIds } : {}),
          documents: Object.entries(decisions).map(([documentId, x]) => ({
            documentId,
            decision: x.decision,
            ...(x.note.trim() ? { note: x.note.trim() } : {}),
          })),
        },
      });
      setReason("");
      setApplicantMessage("");
      setDecisions({});
      setMessage({ tone: "success", text: "Decision recorded." });
    } catch (e) {
      setMessage({
        tone: "error",
        text: e instanceof ApiRequestError ? e.message : "Couldn't save.",
      });
    } finally {
      setBusy(false);
      query.refetch();
    }
  };

  const mark = (documentId: string, decision: "accept" | "reject" | null) =>
    setDecisions((prev) => {
      const next = { ...prev };
      if (decision === null) delete next[documentId];
      else next[documentId] = { decision, note: prev[documentId]?.note ?? "" };
      return next;
    });

  if (!allowed) {
    return (
      <Notice
        tone="info"
        text="Reviewing drivers needs the verify permission."
      />
    );
  }
  if (!d) {
    return query.status === "error" ? (
      <View>
        <Notice tone="error" text={query.error} />
        <ActionButton title="Retry" tone="neutral" onPress={query.refetch} />
      </View>
    ) : (
      <Text className="text-sm text-general-200">Loading…</Text>
    );
  }

  const needsMessage = (a: Action) => a !== "approve" && a !== "reinstate";
  const rejectsNeedNotes = Object.values(decisions).some(
    (x) => x.decision === "reject" && x.note.trim().length < 3,
  );
  const available = ACTIONS.filter((a) => a.from.includes(d.status));
  const categoriesChanged =
    [...categoryIds].sort().join(",") !== currentCategories;
  const selectable = (categories.data ?? []).filter(
    (c) => c.status === "active" || categoryIds.includes(c.id),
  );

  return (
    <View>
      <Pressable onPress={() => router.push("/admin/drivers")}>
        <Text className="text-sm text-[#0286FF]">← Driver applications</Text>
      </Pressable>

      <Section
        title={`${d.displayName} · ${APPLICATION_STATUS[d.status].title}`}
      >
        {d.ownApplication && (
          <Notice
            tone="warning"
            text="This is your own driver application. Another operator must review it."
          />
        )}
        {d.documentsWaived && (
          <Notice
            tone="warning"
            text={`Documents were waived: ${d.waiverNote ?? "no note"}. Ask the driver to upload documents and approve normally to clear the waiver.`}
          />
        )}
        {d.status === "approved" && !d.eligible && (
          <Notice
            tone="warning"
            text="Approval has expired because a document expired. The driver can't go online until an update is approved."
          />
        )}
        <KeyValue label="Account" value={d.account} />
        <KeyValue label="Profile" value={shortId(d.id)} />
        <KeyValue
          label="Vehicle"
          value={`${d.vehicleColor ?? "No colour"} ${d.vehicleMake} ${d.vehicleModel}${d.vehicleYear ? ` (${d.vehicleYear})` : ""}`}
        />
        <KeyValue label="Plate" value={d.plate} />
        <KeyValue label="Seats" value={String(d.vehicleSeats)} />
        <KeyValue
          label="Vehicle categories"
          value={
            d.categories.length
              ? d.categories
                  .map((c) => `${c.name}${c.active ? "" : " (inactive)"}`)
                  .join(", ")
              : "None"
          }
        />
        <KeyValue label="Online" value={d.online ? "Yes" : "No"} />
        <KeyValue label="Submitted" value={when(d.submittedAt)} />
        <KeyValue
          label="Approval valid until"
          value={d.approvalExpiresAt ? when(d.approvalExpiresAt) : "—"}
        />
        <KeyValue label="Review version" value={String(d.version)} />
        {d.applicantMessage && (
          <KeyValue
            label="Last message to applicant"
            value={d.applicantMessage}
          />
        )}
        {d.ineligibleReasons.length > 0 && (
          <KeyValue
            label="Not eligible"
            value={d.ineligibleReasons.join(" ")}
          />
        )}
        {d.activeRide && (
          <Pressable
            onPress={() =>
              router.push({
                pathname: "/admin/rides/[id]",
                params: { id: d.activeRide!.id },
              })
            }
            className="mt-2"
          >
            <Text className="text-sm text-[#0286FF]">
              Active ride {shortId(d.activeRide.id)} ({d.activeRide.status}) →
            </Text>
          </Pressable>
        )}
        <Text className="text-sm mt-4 font-JakartaSemiBold">Requirements</Text>
        {d.requirements.map((r) => (
          <Text key={r.key} className="text-sm py-0.5">
            {r.met ? "✓" : "✗"} {r.label}
          </Text>
        ))}
        {message && <Notice tone={message.tone} text={message.text} />}
      </Section>

      <Section title="Documents">
        <Text className="text-xs text-general-200 mb-2">
          Check each file by eye against the application. Nothing here is
          verified automatically. Each time you open a file it is recorded, and
          the link expires after 60 seconds.
        </Text>
        {d.documents.length === 0 && (
          <Text className="text-sm text-general-200">No documents yet.</Text>
        )}
        {d.documents.map((doc) => {
          const pick = decisions[doc.id];
          const reviewable =
            doc.status === "uploaded" || doc.status === "accepted";
          const viewable = ["uploaded", "accepted", "rejected"].includes(
            doc.status,
          );
          return (
            <View key={doc.id} className="py-3 border-b border-neutral-100">
              <View className="flex flex-row justify-between">
                <Text className="text-sm font-JakartaSemiBold">
                  {DOCUMENT_LABELS[doc.kind]} · {DOCUMENT_STATUS[doc.status]}
                </Text>
                <Text className="text-xs text-general-200">
                  {when(doc.uploadedAt)}
                </Text>
              </View>
              <Text className="text-xs text-neutral-600 mt-1">
                {doc.contentType} · {Math.ceil(doc.sizeBytes / 1024)} KB
                {doc.expiresOn ? ` · expires ${doc.expiresOn}` : ""}
                {doc.reviewedBy
                  ? ` · reviewed by ${doc.reviewedBy} ${when(doc.reviewedAt)}`
                  : ""}
              </Text>
              {doc.reviewNote && (
                <Text className="text-xs text-red-600 mt-1">
                  {doc.reviewNote}
                </Text>
              )}
              <View className="flex flex-row flex-wrap mt-1">
                {viewable && (
                  <ActionButton
                    title="View"
                    tone="neutral"
                    onPress={() => view(doc.id)}
                  />
                )}
                {reviewable && doc.status === "uploaded" && (
                  <ActionButton
                    title={pick?.decision === "accept" ? "✓ Accept" : "Accept"}
                    tone={pick?.decision === "accept" ? "primary" : "neutral"}
                    onPress={() =>
                      mark(
                        doc.id,
                        pick?.decision === "accept" ? null : "accept",
                      )
                    }
                  />
                )}
                {reviewable && (
                  <ActionButton
                    title={pick?.decision === "reject" ? "✗ Reject" : "Reject"}
                    tone={pick?.decision === "reject" ? "danger" : "neutral"}
                    onPress={() =>
                      mark(
                        doc.id,
                        pick?.decision === "reject" ? null : "reject",
                      )
                    }
                  />
                )}
              </View>
              {pick?.decision === "reject" && (
                <Field
                  label="What's wrong with this document (shown to the applicant)"
                  value={pick.note}
                  onChangeText={(note) =>
                    setDecisions((prev) => ({
                      ...prev,
                      [doc.id]: { decision: "reject", note },
                    }))
                  }
                  width="w-full"
                />
              )}
            </View>
          );
        })}
      </Section>

      <Section title="Vehicle categories">
        <Text className="text-xs text-general-200 mb-2">
          Choose the categories this vehicle qualifies for after checking it
          against the documents. The driver can&apos;t change these. Requests
          are matched only when the vehicle has at least as many seats as the
          passengers in the request. Approving needs at least one category.
        </Text>
        {categories.status === "error" && (
          <Notice tone="error" text={categories.error} />
        )}
        {categories.status === "loading" && !categories.data && (
          <Text className="text-sm text-general-200">Loading…</Text>
        )}
        <View className="flex flex-row flex-wrap">
          {selectable.map((c) => (
            <Chip
              key={c.id}
              label={`${c.name} · up to ${c.capacity}${c.status === "active" ? "" : " · inactive"}${c.isDevelopment ? " · development example" : ""}`}
              active={categoryIds.includes(c.id)}
              onPress={() => toggleCategory(c.id)}
            />
          ))}
        </View>
        {selectable.some(
          (c) => categoryIds.includes(c.id) && c.capacity > d.vehicleSeats,
        ) && (
          <Notice
            tone="warning"
            text={`A selected category allows more passengers than this vehicle's ${d.vehicleSeats} seats. The driver will only be offered requests that fit the vehicle.`}
          />
        )}
        {(d.status === "approved" || d.status === "suspended") && (
          <View className="flex flex-row mt-2">
            <ActionButton
              title="Update categories"
              disabled={
                busy ||
                d.ownApplication ||
                !categoriesChanged ||
                categoryIds.length === 0 ||
                reason.trim().length < 3
              }
              onPress={saveCategories}
            />
          </View>
        )}
        {(d.status === "approved" || d.status === "suspended") && (
          <Text className="text-xs text-general-200">
            Uses the internal reason entered under Decision below.
          </Text>
        )}
      </Section>

      <Section title="Decision">
        {available.length === 0 ? (
          <Text className="text-sm text-general-200">
            {d.status === "draft"
              ? "Waiting for the applicant to submit."
              : "No decisions are available in this state."}
          </Text>
        ) : null}
        <Field
          label="Reason (internal, required, recorded in the audit log)"
          value={reason}
          onChangeText={setReason}
          multiline
          width="w-full"
        />
        <Field
          label="Message to the applicant (required except for approve and reinstate)"
          value={applicantMessage}
          onChangeText={setApplicantMessage}
          multiline
          width="w-full"
        />
        <Text className="text-xs text-general-200 mb-2">
          Document choices above are saved together with the decision.
          {Object.keys(decisions).length
            ? ` ${Object.keys(decisions).length} document decision(s) selected.`
            : ""}
        </Text>
        <View className="flex flex-row flex-wrap">
          {available.map((a) => (
            <ActionButton
              key={a.action}
              title={a.title}
              tone={a.tone}
              disabled={
                busy ||
                d.ownApplication ||
                reason.trim().length < 3 ||
                rejectsNeedNotes ||
                (a.action === "approve" && categoryIds.length === 0) ||
                (needsMessage(a.action) && applicantMessage.trim().length < 3)
              }
              onPress={() => decide(a.action)}
            />
          ))}
        </View>
        {d.status === "approved" && d.activeRide && (
          <Text className="text-xs text-general-200 mt-2">
            Suspending during a ride: before pickup the passenger is re-matched
            to another driver; after pickup the driver can finish the trip and
            the ride is flagged for review.
          </Text>
        )}
      </Section>

      <Section title="History">
        {d.history.map((h, i) => (
          <Text key={i} className="text-sm py-0.5">
            {when(h.createdAt)} · {h.action.replace(/_/g, " ")}
            {h.toStatus && h.fromStatus !== h.toStatus
              ? ` → ${h.toStatus}`
              : ""}
            {h.operator ? ` · ${h.operator}` : ` · ${h.actor}`}
            {h.reason ? ` · ${h.reason}` : ""}
            {h.applicantMessage ? ` · to applicant: ${h.applicantMessage}` : ""}
          </Text>
        ))}
      </Section>
    </View>
  );
};

export default DriverApplication;
