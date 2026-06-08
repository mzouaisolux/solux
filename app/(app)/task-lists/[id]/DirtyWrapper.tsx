"use client";
// Thin client wrapper that injects the DirtyProvider around the task-list
// content. The page itself is a server component and can't call hooks.
export { DirtyProvider as DirtyWrapper } from "./DirtyContext";
