export function dataUrlToBlob(value: string) {
    const comma = value.indexOf(",");
    if (!value.startsWith("data:") || comma < 5) throw new TypeError("Invalid data URL");

    const metadata = value.slice(5, comma);
    const payload = value.slice(comma + 1);
    const fields = metadata.split(";");
    const mimeType = fields[0] || "application/octet-stream";
    const base64 = fields.slice(1).some((field) => field.toLowerCase() === "base64");

    if (!base64) return new Blob([decodeURIComponent(payload)], { type: mimeType });

    const binary = atob(payload.replace(/[\t\n\r ]+/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type: mimeType });
}
