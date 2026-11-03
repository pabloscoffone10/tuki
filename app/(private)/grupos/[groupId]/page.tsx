import { Suspense } from "react";
import { GroupDetail } from "@/features/groups/components/group-detail";
import Loading from "@/app/loading";
export const metadata = { title: "Mi grupo" };
export default function GroupPage({ params,searchParams }: PageProps<"/grupos/[groupId]">) {
  return <Suspense fallback={<Loading />}><GroupDetail params={params} searchParams={searchParams} /></Suspense>;
}
