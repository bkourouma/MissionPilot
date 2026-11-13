import Link from "next/link";
import type { Metadata } from "next";
import { Carte } from "../../../../../../../components/ui/Carte";
import { EtatErreur } from "../../../../../../../components/ui/EtatListe";
import { Tableau } from "../../../../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../../../../lib/api-serveur";
import {
  CHAMP_AJUSTEMENT_LIBELLES,
  CHAMP_AJUSTEMENT_LIBELLES_EN,
  cheminAjustements,
  filtrerAjustements,
  hrefEcranDossier,
  libellesDd,
  libelleValeurAjustement,
  lireCibleAjustement,
  type AjustementDd,
} from "../../../../../../../lib/due-diligence";
import { formaterDateHeure } from "../../../../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../../../../lib/i18n/serveur";
import { exigerPermission } from "../../../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Ajustements", "Adjustments") };
}

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
  const langue = await obtenirLangue();
  const t = await obtenirT();
  const L = libellesDd(langue);
  const champs = langue === "en" ? CHAMP_AJUSTEMENT_LIBELLES_EN : CHAMP_AJUSTEMENT_LIBELLES;
  await exigerPermission("dd.lire");
  const cible = lireCibleAjustement(await searchParams);
  const r = await chargerServeur<{ elements: AjustementDd[] }>(cheminAjustements(dossierId));
  const base = hrefEcranDossier(id, dossierId, "ajustements");
  if (!r.ok) {
    return (
      <EtatErreur
        titre={t(
          "Les ajustements n'ont pas pu être chargés.",
          "The adjustments could not be loaded.",
        )}
        message={r.message}
        hrefReessayer={base}
      />
    );
  }
  const lignes = filtrerAjustements(r.donnees.elements, cible);

  return (
    <>
      <nav
        aria-label={t("Filtrer par type de cible", "Filter by target type")}
        className="mp-onglets"
      >
        <ul className="mp-onglets__liste">
          <li>
            <Link
              href={base}
              className="mp-onglets__lien"
              aria-current={cible ? undefined : "page"}
            >
              {t("Tous", "All")}
            </Link>
          </li>
          {CIBLES.map((c) => (
            <li key={c}>
              <Link
                href={`${base}?cible=${c}`}
                className="mp-onglets__lien"
                aria-current={cible === c ? "page" : undefined}
              >
                {L.CIBLE_AJUSTEMENT[c]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <Carte titre={t("Ajustements tracés", "Traced adjustments")} niveauTitre={3}>
        <Tableau
          legende={t(
            "Ajustements de l'expert, du plus récent au plus ancien",
            "Expert adjustments, from newest to oldest",
          )}
          lignes={lignes}
          cleLigne={(a) => a.id}
          messageVide={
            cible
              ? t("Aucun ajustement de ce type.", "No adjustment of this type.")
              : t(
                  "Aucun ajustement : l'expert n'a encore écarté aucune proposition du moteur ni de la bibliothèque.",
                  "No adjustment: the expert has not yet departed from any engine or library proposal.",
                )
          }
          colonnes={[
            {
              cle: "cible",
              entete: t("Cible", "Target"),
              rendu: (a) => L.CIBLE_AJUSTEMENT[a.cible_type],
            },
            {
              cle: "champ",
              entete: t("Champ", "Field"),
              rendu: (a) => champs[a.champ] ?? a.champ,
            },
            {
              cle: "valeur_avant",
              entete: t("Avant", "Before"),
              rendu: (a) => libelleValeurAjustement(a, a.valeur_avant, langue),
            },
            {
              cle: "valeur_apres",
              entete: t("Après", "After"),
              rendu: (a) => libelleValeurAjustement(a, a.valeur_apres, langue),
            },
            { cle: "motif", entete: t("Motif", "Reason") },
            {
              cle: "cree_le",
              entete: t("Date", "Date"),
              rendu: (a) => formaterDateHeure(a.cree_le, undefined, langue),
            },
          ]}
        />
      </Carte>
    </>
  );
}
