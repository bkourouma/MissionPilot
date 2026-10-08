/** Texte court pour un message : espaces normalisés, tronqué à 80 caractères avec « … ». */
export function abreger(texte: string): string {
  const net = texte.replace(/\s+/g, " ").trim();
  return net.length > 80 ? `${net.slice(0, 79)}…` : net;
}
