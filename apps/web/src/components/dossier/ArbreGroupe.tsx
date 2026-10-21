import Link from "next/link";
import type { CSSProperties } from "react";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Carte } from "../ui/Carte";
import { EtatVide } from "../ui/EtatListe";
import { aplatirStructure, formaterPart, type GroupeApi } from "../../lib/dossier-groupes";
import "./groupe.css";

/**
 * Structure de détention du groupe (DOS-05) en listes lisibles, indentées selon le niveau. Un
 * dossier non visible avec les droits de l'utilisateur reste un noeud anonyme : ni nom ni lien.
 * Les parts sont des points de base de l'API divisés par 100 (aucun calcul métier ici).
 */
export function ArbreGroupe({ groupe }: { groupe: GroupeApi }) {
  const blocs = aplatirStructure(groupe);
  const seul =
    groupe.structure.detenteurs.length === 0 &&
    groupe.structure.filiales.length === 0 &&
    !(groupe.structure.arbre_tete && groupe.structure.arbre_tete.length > 0);

  if (seul) {
    return (
      <EtatVide titre="Ce dossier n'a ni détenteur ni filiale à cette date." icone="trombone">
        <p>Saisissez une participation ci-dessous pour constituer le groupe.</p>
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
                    {l.estDossier ? <BadgeStatut tonalite="neutre">Ce dossier</BadgeStatut> : null}
                  </span>
                  <span className="mp-groupe-noeud__parts">
                    <span>Niveau {n.niveau}</span>
                    {n.part_directe_bps !== undefined && n.part_directe_bps !== null ? (
                      <span>Part directe : {formaterPart(n.part_directe_bps)}</span>
                    ) : null}
                    <span>Part cumulée : {formaterPart(n.part_cumulee_bps)}</span>
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
