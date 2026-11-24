export const fileSize = (bytes: number) =>
  bytes < 1000
    ? `${bytes} B`
    : bytes < 1000000
      ? `${(bytes / 1000).toFixed(1)} KB`
      : `${(bytes / 1000000).toFixed(1)} MB`;
