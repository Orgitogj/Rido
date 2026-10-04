import * as DocumentPicker from "expo-document-picker";
import { useCallback, useEffect, useRef, useState } from "react";

import { useApi } from "@/lib/fetch";
import { newClientId } from "@/lib/places";
import {
  checkImage,
  type DraftProblem,
  type LocalFile,
  problemFromError,
  uploadWithProgress,
} from "@/lib/upload";
import { SUPPORT_RULES, type SupportAttachmentTicket } from "@/shared/account";

export interface DraftAttachment {
  localId: string;
  name: string;
  size: number;
  status: "uploading" | "checking" | "ready" | "failed";
  progress: number;
  serverId: string | null;
  problem: DraftProblem | null;
}

interface Internal extends DraftAttachment {
  file: LocalFile;
  contentType: "image/jpeg" | "image/png";
  abort: { aborted: boolean; onAbort?: () => void };
}

const publicView = (a: Internal): DraftAttachment => ({
  localId: a.localId,
  name: a.name,
  size: a.size,
  status: a.status,
  progress: a.progress,
  serverId: a.serverId,
  problem: a.problem,
});

export function useSupportAttachments(max: number) {
  const request = useApi();
  const items = useRef<Internal[]>([]);
  const mounted = useRef(true);
  const [list, setList] = useState<DraftAttachment[]>([]);
  const [pickProblem, setPickProblem] = useState<DraftProblem | null>(null);

  const publish = useCallback(() => {
    if (mounted.current) setList(items.current.map(publicView));
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const item of items.current) {
        item.abort.aborted = true;
        item.abort.onAbort?.();
      }
    };
  }, []);

  const run = useCallback(
    async (item: Internal) => {
      item.status = "uploading";
      item.progress = 0;
      item.problem = null;
      item.abort = { aborted: false };
      publish();
      try {
        if (item.serverId) {
          await request(`/api/support/attachments/${item.serverId}`, {
            method: "DELETE",
          }).catch(() => undefined);
          item.serverId = null;
        }
        const ticket = await request<SupportAttachmentTicket>(
          "/api/support/attachments",
          { body: { contentType: item.contentType, sizeBytes: item.size } },
        );
        item.serverId = ticket.attachment.id;
        await uploadWithProgress(
          ticket.upload,
          item.file,
          (fraction) => {
            item.progress = fraction;
            publish();
          },
          item.abort,
        );
        item.status = "checking";
        publish();
        await request(`/api/support/attachments/${item.serverId}/complete`, {
          method: "POST",
        });
        item.status = "ready";
        item.progress = 1;
      } catch (e) {
        if (item.abort.aborted) return;
        item.status = "failed";
        item.problem = problemFromError(e);
      }
      publish();
    },
    [publish, request],
  );

  const pick = useCallback(async () => {
    setPickProblem(null);
    if (items.current.length >= max) {
      setPickProblem("limit");
      return;
    }
    const picked = await DocumentPicker.getDocumentAsync({
      type: ["image/jpeg", "image/png"],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (picked.canceled || !picked.assets?.[0]) return;
    const asset = picked.assets[0];
    const checked = checkImage(asset.name, asset.mimeType, asset.size, {
      minBytes: SUPPORT_RULES.attachmentMinBytes,
      maxBytes: SUPPORT_RULES.attachmentMaxBytes,
    });
    if (!checked.ok) {
      setPickProblem(checked.reason);
      return;
    }
    const item: Internal = {
      localId: newClientId(),
      name: asset.name,
      size: checked.size,
      status: "uploading",
      progress: 0,
      serverId: null,
      problem: null,
      contentType: checked.contentType,
      file: {
        uri: asset.uri,
        name: asset.name,
        contentType: checked.contentType,
        blob: asset.file ?? null,
      },
      abort: { aborted: false },
    };
    items.current = [...items.current, item];
    await run(item);
  }, [max, run]);

  const retry = useCallback(
    async (localId: string) => {
      const item = items.current.find((i) => i.localId === localId);
      if (item && item.status === "failed") await run(item);
    },
    [run],
  );

  const remove = useCallback(
    async (localId: string) => {
      const item = items.current.find((i) => i.localId === localId);
      if (!item) return;
      item.abort.aborted = true;
      item.abort.onAbort?.();
      items.current = items.current.filter((i) => i.localId !== localId);
      publish();
      if (item.serverId) {
        await request(`/api/support/attachments/${item.serverId}`, {
          method: "DELETE",
        }).catch(() => undefined);
      }
    },
    [publish, request],
  );

  const clear = useCallback(() => {
    items.current = [];
    publish();
  }, [publish]);

  return {
    list,
    pickProblem,
    pick,
    retry,
    remove,
    clear,
    busy: list.some((a) => a.status === "uploading" || a.status === "checking"),
    blocked: list.some((a) => a.status !== "ready"),
    readyIds: list
      .filter((a) => a.status === "ready" && a.serverId)
      .map((a) => a.serverId!),
  };
}
