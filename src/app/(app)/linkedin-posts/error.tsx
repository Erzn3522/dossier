"use client";

import { ScreenError, type ErrorPageProps } from "@/components/screen-error";

export default function Error(props: ErrorPageProps) {
  return <ScreenError {...props} title="LinkedIn posts could not be loaded" />;
}
