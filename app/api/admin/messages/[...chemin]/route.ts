import { creerRelais } from "@/lib/adminRelay";

const relayer = creerRelais("messages", "referer");

export const GET = relayer;
export const POST = relayer;
export const PUT = relayer;
export const DELETE = relayer;
