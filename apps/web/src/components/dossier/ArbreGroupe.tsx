import Link from "next/link";
import type { CSSProperties } from "react";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Carte } from "../ui/Carte";
import { EtatVide } from "../ui/EtatListe";
import { obtenirLangue } from "../../lib/i18n/serveur";
import { aplatirStructure, formaterPart, type GroupeApi } from "../../lib/dossier-groupes";
import "./groupe.css";

/**
 * Structure de détention du groupe (DOS-05) en listes lisibles, indentées selon le niveau. Un
 * dossier non visible avec les droits de l'utilisateur reste un noeud anonyme : ni nom ni lien.
 * Les parts sont des points de base de l'API divisés par 100 (aucun calcul métier ici).
 */
export async function ArbreGroupe({ groupe }: { groupe: GroupeApi }) {
  const langue = await obtenirLangue();
  const t = (fr: string, en: string) => (langue === "en" ? en : fr);
  const blocs = aplatirStructure(groupe, langue);
  const seul =
    groupe.structure.detenteurs.length === 0 &&
    groupe.structure.filiales.length === 0 &&
    !(groupe.structure.arbre_tete && groupe.structure.arbre_tete.length > 0);

  if (seul) {
    return (
      <EtatVide
        titre={t(
          "Ce dossier n'a ni détenteur ni filiale à cette date.",
          "This file has no holder or subsidiary at this date.",
        )}
        icone="trombone"
      >
        <p>
          {t(
            "Saisissez une participation ci-dessous pour constituer le groupe.",
            "Enter a holding below to build the group.",
          )}
        </p>
      </EtatVide>
    );
  }

  return (
    <>
      {blocs.map((b) => (
        <Carte key={b.id} titre={b.titre} niveauTitre={2}>
          <ul className="mp-groupe-arbre">
            {b.lignes.map((l) => {
              const n = l.noeud;
              const classe = [
                "mp-groupe-noeud",
                l.estDossier ? "mp-groupe-noeud--dossier" : "",
                n.visible ? "" : "mp-groupe-noeud--anonyme",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <li
                  key={l.cle}
                  className={classe}
                  style={{ "--mp-profondeur": l.profondeur } as CSSProperties}
                >
                  <span className="mp-groupe-noeud__nom">
                    {n.visible && n.id && !l.estDossier ? (
                      <Link href={`/dossiers/${n.id}/groupe`} className="mp-lien-ligne">
                        {l.libelle}
                      </Link>
                    ) : (
                      l.libelle
                    )}{" "}
                    {l.estDossier ? (
                      <BadgeStatut tonalite="neutre">{t("Ce dossier", "This file")}</BadgeStatut>
                    ) : null}
                  </span>
                  <span className="mp-groupe-noeud__parts">
                    <span>
                      {t("Niveau", "Level")} {n.niveau}
                    </span>
                    {n.part_directe_bps !== undefined && n.part_directe_bps !== null ? (
                      <span>
                        {t("Part directe", "Direct share")}
                        {t(" : ", ": ")}
                        {formaterPart(n.part_directe_bps, langue)}
                      </span>
                    ) : null}
                    <span>
                      {t("Part cumulée", "Cumulative share")}
                      {t(" : ", ": ")}
                      {formaterPart(n.part_cumulee_bps, langue)}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </Carte>
      ))}
    </>
  );
}
