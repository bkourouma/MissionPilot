import Link from "next/link";
import type { Metadata } from "next";
import { Carte } from "../../../../../../../components/ui/Carte";
import { EtatErreur } from "../../../../../../../components/ui/EtatListe";
import { Tableau } from "../../../../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../../../../lib/api-serveur";
import {
  CHAMP_AJUSTEMENT_LIBELLES,
  CIBLE_AJUSTEMENT_LIBELLES,
  cheminAjustements,
  filtrerAjustements,
  hrefEcranDossier,
  libelleValeurAjustement,
  lireCibleAjustement,
  type AjustementDd,
} from "../../../../../../../lib/due-diligence";
import { formaterDateHeure } from "../../../../../../../lib/format";
import { exigerPermission } from "../../../../../../../lib/session";

export const metadata: Metadata = { title: "Ajustements" };

const CIBLES = ["verdict", "risque", "dimensionnement"] as const;

/**
 * Ajustements tracés (DD-08) : chaque écart de l'expert à une proposition d'un moteur ou de la
 * bibliothèque (verdict, niveau d'un risque, ajustement de marché), avec sa valeur avant, sa valeur
 * après et son motif. Créés par l'API, jamais saisis ici ; repris dans la note au comité.
 */
export default async function PageAjustementsDd({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; dossierId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id, dossierId } = await params;
  await exigerPermission("dd.lire");
  const cible = lireCibleAjustement(await searchParams);
  const r = await chargerServeur<{ elements: AjustementDd[] }>(cheminAjustements(dossierId));
  const base = hrefEcranDossier(id, dossierId, "ajustements");
  if (!r.ok) {
    return (
      <EtatErreur
        titre="Les ajustements n'ont pas pu être chargés."
        message={r.message}
        hrefReessayer={base}
      />
    );
  }
  const lignes = filtrerAjustements(r.donnees.elements, cible);

  return (
    <>
      <nav aria-label="Filtrer par type de cible" className="mp-onglets">
        <ul className="mp-onglets__liste">
          <li>
            <Link
              href={base}
              className="mp-onglets__lien"
              aria-current={cible ? undefined : "page"}
            >
              Tous
            </Link>
          </li>
          {CIBLES.map((c) => (
            <li key={c}>
              <Link
                href={`${base}?cible=${c}`}
                className="mp-onglets__lien"
                aria-current={cible === c ? "page" : undefined}
              >
                {CIBLE_AJUSTEMENT_LIBELLES[c]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <Carte titre="Ajustements tracés" niveauTitre={3}>
        <Tableau
          legende="Ajustements de l'expert, du plus récent au plus ancien"
          lignes={lignes}
          cleLigne={(a) => a.id}
          messageVide={
            cible
              ? "Aucun ajustement de ce type."
              : "Aucun ajustement : l'expert n'a encore écarté aucune proposition du moteur ni de la bibliothèque."
          }
          colonnes={[
            {
              cle: "cible",
              entete: "Cible",
              rendu: (a) => CIBLE_AJUSTEMENT_LIBELLES[a.cible_type],
            },
            {
              cle: "champ",
              entete: "Champ",
              rendu: (a) => CHAMP_AJUSTEMENT_LIBELLES[a.champ] ?? a.champ,
            },
            {
              cle: "valeur_avant",
              entete: "Avant",
              rendu: (a) => libelleValeurAjustement(a, a.valeur_avant),
            },
            {
              cle: "valeur_apres",
              entete: "Après",
              rendu: (a) => libelleValeurAjustement(a, a.valeur_apres),
            },
            { cle: "motif", entete: "Motif" },
            { cle: "cree_le", entete: "Date", rendu: (a) => formaterDateHeure(a.cree_le) },
          ]}
        />
      </Carte>
    </>
  );
}
