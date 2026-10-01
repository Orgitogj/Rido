import * as DocumentPicker from "expo-document-picker";
import { useState } from "react";
import { Text, View } from "react-native";

import CustomButton from "@/components/CustomButton";
import InputField from "@/components/InputField";
import {
  checkFile,
  currentDocument,
  isIsoDate,
  needsExpiry,
  UploadError,
  uploadToStorage,
} from "@/lib/driverVerification";
import { useApi } from "@/lib/fetch";
import { useI18n } from "@/lib/i18n";
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
  const { t, error: errorText } = useI18n();
  const request = useApi();
  const [expiresOn, setExpiresOn] = useState(document?.expiresOn ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = async () => {
    setError(null);
    if (needsExpiry(kind) && !isIsoDate(expiresOn.trim())) {
      setError(t("driver.documents.expiryRequired"));
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
      setError(t(`driver.documents.${checked.reason}`));
      return;
    }
    try {
      setBusy(t("driver.documents.preparing"));
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
      setBusy(t("driver.documents.uploading"));
      await uploadToStorage(ticket, {
        uri: asset.uri,
        name: asset.name,
        contentType: checked.contentType,
        blob: asset.file ?? null,
      });
      setBusy(t("driver.documents.checking"));
      await request(`/api/driver/documents/${ticket.document.id}/complete`, {
        method: "POST",
      });
      await onChanged();
    } catch (e) {
      setError(
        e instanceof UploadError && e.code === "STORAGE_REFUSED"
          ? t("driver.documents.storageRefused")
          : errorText(e, t("driver.documents.uploadFailed")),
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
          {t(`driver.documents.kind.${kind}`)}
        </Text>
        <Text
          className={`text-sm ${
            document?.status === "accepted"
              ? "text-green-700"
              : document?.status === "rejected"
                ? "text-red-600"
                : "text-general-200"
          }`}
        >
          {document
            ? t(`driver.documents.status.${document.status}`)
            : t("driver.documents.notUploaded")}
        </Text>
      </View>
      {document?.expiresOn && (
        <Text className="text-xs text-general-200 mt-1">
          {t("driver.documents.expires", { date: document.expiresOn })}
        </Text>
      )}
      {document?.reviewNote && (
        <Text className="text-sm text-red-600 mt-1">{document.reviewNote}</Text>
      )}
      {editable && (
        <>
          {needsExpiry(kind) && (
            <InputField
              label={t("driver.documents.expiry")}
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
                ? t("driver.documents.replace")
                : t("driver.documents.choose"))
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
          className="text-sm text-red-600 mt-2"
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
}) => {
  const { t } = useI18n();
  return (
    <View className="bg-white rounded-2xl p-5 mt-5">
      <Text className="text-lg font-JakartaBold" accessibilityRole="header">
        {t("driver.documents.title")}
      </Text>
      <Text className="text-sm text-general-200 mt-1">
        {t("driver.documents.intro")}
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
};

export default DriverDocuments;
