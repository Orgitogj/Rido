import * as DocumentPicker from "expo-document-picker";
import { useState } from "react";
import { Text, View } from "react-native";

import CustomButton from "@/components/CustomButton";
import InputField from "@/components/InputField";
import {
  checkFile,
  currentDocument,
  DOCUMENT_LABELS,
  DOCUMENT_STATUS,
  isIsoDate,
  needsExpiry,
  uploadToStorage,
} from "@/lib/driverVerification";
import { ApiRequestError, useApi } from "@/lib/fetch";
import {
  type DocumentKind,
  documentKinds,
  type DocumentUploadTicket,
  type DriverDocumentView,
} from "@/shared/contracts";

const DocumentRow = ({
  kind,
  document,
  editable,
  onChanged,
}: {
  kind: DocumentKind;
  document: DriverDocumentView | null;
  editable: boolean;
  onChanged: () => Promise<void> | void;
}) => {
  const request = useApi();
  const [expiresOn, setExpiresOn] = useState(document?.expiresOn ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = async () => {
    setError(null);
    if (needsExpiry(kind) && !isIsoDate(expiresOn.trim())) {
      setError("Enter the expiry date shown on the document (YYYY-MM-DD).");
      return;
    }
    const picked = await DocumentPicker.getDocumentAsync({
      type: ["image/jpeg", "image/png", "application/pdf"],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (picked.canceled || !picked.assets?.[0]) return;
    const asset = picked.assets[0];
    const checked = checkFile(asset.name, asset.mimeType, asset.size);
    if (!checked.ok) {
      setError(checked.message);
      return;
    }
    try {
      setBusy("Preparing…");
      const ticket = await request<DocumentUploadTicket>(
        "/api/driver/documents",
        {
          body: {
            kind,
            contentType: checked.contentType,
            sizeBytes: checked.size,
            expiresOn: needsExpiry(kind) ? expiresOn.trim() : null,
          },
        },
      );
      setBusy("Uploading…");
      await uploadToStorage(ticket, {
        uri: asset.uri,
        name: asset.name,
        contentType: checked.contentType,
        blob: asset.file ?? null,
      });
      setBusy("Checking…");
      await request(`/api/driver/documents/${ticket.document.id}/complete`, {
        method: "POST",
      });
      await onChanged();
    } catch (e) {
      setError(
        e instanceof ApiRequestError || e instanceof Error
          ? e.message
          : "Upload failed. Try again.",
      );
      await onChanged();
    } finally {
      setBusy(null);
    }
  };

  return (
    <View className="border-t border-general-700 pt-3 mt-3">
      <View className="flex flex-row items-center justify-between">
        <Text className="text-base font-JakartaSemiBold">
          {DOCUMENT_LABELS[kind]}
        </Text>
        <Text
          className={`text-sm ${
            document?.status === "accepted"
              ? "text-green-700"
              : document?.status === "rejected"
                ? "text-red-500"
                : "text-general-200"
          }`}
        >
          {document ? DOCUMENT_STATUS[document.status] : "Not uploaded"}
        </Text>
      </View>
      {document?.expiresOn && (
        <Text className="text-xs text-general-200 mt-1">
          Expires {document.expiresOn}
        </Text>
      )}
      {document?.reviewNote && (
        <Text className="text-sm text-red-500 mt-1">{document.reviewNote}</Text>
      )}
      {editable && (
        <>
          {needsExpiry(kind) && (
            <InputField
              label="Expiry date (YYYY-MM-DD)"
              value={expiresOn}
              onChangeText={setExpiresOn}
              autoCapitalize="none"
              containerStyle="w-full"
              inputStyle="p-3.5"
            />
          )}
          <CustomButton
            title={
              busy ??
              (document && document.status !== "pending_upload"
                ? "Replace file"
                : "Choose file")
            }
            bgVariant="outline"
            textVariant="primary"
            disabled={Boolean(busy)}
            className="mt-2"
            onPress={upload}
          />
        </>
      )}
      {error && (
        <Text
          className="text-sm text-red-500 mt-2"
          accessibilityLiveRegion="polite"
        >
          {error}
        </Text>
      )}
    </View>
  );
};

const DriverDocuments = ({
  documents,
  editable,
  onChanged,
}: {
  documents: DriverDocumentView[];
  editable: boolean;
  onChanged: () => Promise<void> | void;
}) => (
  <View className="bg-white rounded-2xl p-5 mt-5">
    <Text className="text-lg font-JakartaBold">Documents</Text>
    <Text className="text-sm text-general-200 mt-1">
      JPEG, PNG, or PDF up to 10 MB. Files are stored privately and are only
      seen by the operators who review your application. A person checks them;
      nothing is verified automatically.
    </Text>
    {documentKinds.map((kind) => (
      <DocumentRow
        key={`${kind}-${currentDocument(documents, kind)?.id ?? "none"}`}
        kind={kind}
        document={currentDocument(documents, kind)}
        editable={editable}
        onChanged={onChanged}
      />
    ))}
  </View>
);

export default DriverDocuments;
