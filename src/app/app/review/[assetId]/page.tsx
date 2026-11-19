"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Player } from "@/components/player";
import { apiSend, uploadFile } from "@/lib/client";
import { Comment, Mark, Me, Version } from "@/lib/types";

type Payload = {
  asset: {
    id: string;
    projectId: string;
    name: string;
    status: string;
    assigneeId: string | null;
    currentVersionId: string | null;
  };
  versions: Version[];
  comments: Comment[];
  members: { id: string; name: string }[];
};

export default function ReviewPage() {
  const params = useParams<{ assetId: string }>();
  const [me, setMe] = useState<Me | null>(null);
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sentLink, setSentLink] = useState<string | null>(null);

  async function load() {
    const [account, payload] = await Promise.all([
      apiSend<Me>("/api/auth/me"),
      apiSend<Payload>(`/api/assets/${params.assetId}`),
    ]);
    setMe(account);
    setData({
      ...payload,
      comments: payload.comments.map((comment) => ({ ...comment, markup: (comment.markup ?? []) as Mark[] })),
    });
  }

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Could not open the cut."));
  }, [params.assetId]);

  if (!data || !me) {
    return <main className="page">{error ? <p className="error">{error}</p> : <p className="muted">Loading the cut…</p>}</main>;
  }

  return (
    <Player
      title={data.asset.name}
      backHref={`/app/projects/${data.asset.projectId}`}
      versions={data.versions}
      comments={data.comments}
      initialVersionId={data.asset.currentVersionId}
      mediaUrl={(versionId) => `/api/media/${versionId}`}
      allowComment
      allowDownload
      canInternal={me.workspace.plan.features.internalComments}
      status={data.asset.status}
      assigneeId={data.asset.assigneeId}
      members={data.members}
      onStatus={async (status) => {
        await apiSend(`/api/assets/${data.asset.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
        await load();
      }}
      onAssignee={async (assigneeId) => {
        await apiSend(`/api/assets/${data.asset.id}`, { method: "PATCH", body: JSON.stringify({ assigneeId }) });
        await load();
      }}
      onComment={async (input) => {
        await apiSend(`/api/assets/${data.asset.id}/comments`, { method: "POST", body: JSON.stringify(input) });
        await load();
      }}
      onResolve={async (id) => {
        await apiSend(`/api/comments/${id}`, { method: "POST" });
        await load();
      }}
      onDelete={async (id) => {
        await apiSend(`/api/comments/${id}`, { method: "DELETE" });
        await load();
      }}
      onNewVersion={async (file) => {
        await uploadFile(file, { assetId: data.asset.id });
        await load();
      }}
      sentLink={sentLink}
      onSend={async () => {
        const created = await apiSend<{ share: { url: string | null } }>("/api/shares", {
          method: "POST",
          body: JSON.stringify({
            projectId: data.asset.projectId,
            name: data.asset.name,
            assetIds: [data.asset.id],
          }),
        });
        if (!created.share.url) throw new Error("The review link did not come back.");
        setSentLink(created.share.url);
      }}
    />
  );
}
