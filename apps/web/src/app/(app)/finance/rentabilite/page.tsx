import Link from "next/link";
import type { Metadata } from "next";
import { creerTraduire, type Langue } from "@missionpilot/shared";
import { Alerte } from "../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { classesBouton } from "../../../../components/ui/Bouton";
import { Carte } from "../../../../components/ui/Carte";
import { Champ } from "../../../../components/ui/Champ";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../components/ui/EtatListe";
import { Icone } from "../../../../components/ui/Icone";
import { Select } from "../../../../components/ui/Select";
import { Tableau } from "../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../lib/api-serveur";
import {
  formaterDate,
  formaterJours,
  formaterMontantMineur,
  formaterPourcentage,
  libelleDevise,
} from "../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";
import { statutMarge } from "../../../../lib/indicateurs";
import {
  libelleNiveauRentabilite,
  lireFiltresRentabilite,
  optionsNiveauxRentabilite,
  RAISON_EXCLUSION,
  RAISON_EXCLUSION_EN,
  requeteRentabilite,
  type ReponseRentabilite,
} from "../../../../lib/rentabilite";
import { exigerPermission } from "../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Rentabilité", "Profitability") };
}

/**
 * Rentabilité (FIN-12) : « finance.lire » OBLIGATOIRE. Sans ce droit, `exigerPermission`
 * redirige vers « Accès refusé » AVANT tout appel à l'API.
 */
export default async function PageRentabilite({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigerPermission("finance.lire");
  const langue = await obtenirLangue();
  const t = creerTraduire(langue);
  const f = lireFiltresRentabilite(await searchParams);
  const requete = requeteRentabilite(f);
  const r = await chargerServeur<ReponseRentabilite>(`/api/finance/rentabilite?${requete}`);

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Rentabilité", "Profitability")}
        soustitre={t(
          "Honoraires facturés, coûts internes, débours non refacturés, sous-traitance et marge sur la période, avec le budget, le réalisé et l'atterrissage en jours. Données confidentielles du cabinet.",
          "Fees invoiced, internal costs, non-re-billed expenses, subcontracting and margin over the period, with the budget, actuals and landing in days. Confidential firm data.",
        )}
      />
      <form
        method="get"
        action="/finance/rentabilite"
        className="mp-filtres"
        role="search"
        aria-label={t("Période et regroupement", "Period and grouping")}
      >
        <div className="mp-grille-champs mp-grille-champs--filtres">
          <Select
            libelle={t("Regrouper par", "Group by")}
            name="niveau"
            options={optionsNiveauxRentabilite(langue)}
            defaultValue={f.niveau}
          />
          <Champ libelle={t("Du", "From")} type="date" name="du" defaultValue={f.du} required />
          <Champ
            libelle={t("Au", "To")}
            type="date"
            name="au"
            defaultValue={f.au}
            required
            aide={t("Période de 366 jours au plus.", "Period of 366 days at most.")}
          />
        </div>
        <div className="mp-actions-formulaire">
          <button type="submit" className={classesBouton("primaire")}>
            <Icone nom="entonnoir" />
            <span>{t("Afficher", "Show")}</span>
          </button>
        </div>
      </form>
      {f.corrigee ? (
        <Alerte tonalite="attention" annonce="status">
          <p>
            {t(
              "Période invalide ou de plus de 366 jours : la période par défaut (année en cours) est affichée.",
              "Invalid period or longer than 366 days: the default period (current year) is shown.",
            )}
          </p>
        </Alerte>
      ) : null}
      {!r.ok ? (
        <EtatErreur
          titre={t(
            "La rentabilité n'a pas pu être calculée.",
            "The profitability could not be computed.",
          )}
          message={r.message}
          hrefReessayer={`/finance/rentabilite?${requete}`}
        />
      ) : (
        <Resultats r={r.donnees} langue={langue} />
      )}
    </div>
  );
}

function Resultats({ r, langue }: { r: ReponseRentabilite; langue: Langue }) {
  const t = creerTraduire(langue);
  const m = (v: number) => formaterMontantMineur(v, r.devise, langue);
  const statutTotal = statutMarge(r.total.taux_marge, r.total.marge, langue);
  const niveau = libelleNiveauRentabilite(r.niveau, langue);
  const raison = (langue === "en" ? RAISON_EXCLUSION_EN : RAISON_EXCLUSION).TAUX_CHANGE_ABSENT;
  return (
    <>
      <Carte
        titre={t(
          `Total du ${formaterDate(r.du)} au ${formaterDate(r.au)}`,
          `Total from ${formaterDate(r.du, "UTC", langue)} to ${formaterDate(r.au, "UTC", langue)}`,
        )}
      >
        <ul className="mp-totaux">
          <li className="mp-totaux__element">
            <span className="mp-totaux__libelle">{t("Honoraires", "Fees")}</span>
            <span className="mp-totaux__valeur">{m(r.total.honoraires)}</span>
          </li>
          <li className="mp-totaux__element">
            <span className="mp-totaux__libelle">{t("Coûts internes", "Internal costs")}</span>
            <span className="mp-totaux__valeur">{m(r.total.couts_internes)}</span>
          </li>
          <li className="mp-totaux__element">
            <span className="mp-totaux__libelle">
              {t("Débours non refacturés", "Non-re-billed expenses")}
            </span>
            <span className="mp-totaux__valeur">{m(r.total.debours_non_refactures)}</span>
          </li>
          <li className="mp-totaux__element">
            <span className="mp-totaux__libelle">{t("Sous-traitance", "Subcontracting")}</span>
            <span className="mp-totaux__valeur">{m(r.total.sous_traitance)}</span>
          </li>
          <li className="mp-totaux__element">
            <span className="mp-totaux__libelle">{t("Marge", "Margin")}</span>
            <span className="mp-totaux__valeur">{m(r.total.marge)}</span>
            <span>
              {`${formaterPourcentage(r.total.taux_marge, 1, langue)} `}
              <BadgeStatut tonalite={statutTotal.tonalite}>{statutTotal.libelle}</BadgeStatut>
            </span>
          </li>
        </ul>
        {r.missions_exclues.length > 0 ? (
          <p className="mp-texte-doux">
            {t(
              `${r.missions_exclues.length} mission(s) exclue(s) : ${RAISON_EXCLUSION.TAUX_CHANGE_ABSENT}.`,
              `${r.missions_exclues.length} engagement(s) excluded: ${raison}.`,
            )}
          </p>
        ) : null}
      </Carte>
      {r.elements.length === 0 ? (
        <EtatVide
          titre={t(
            "Aucune activité facturée ni produite sur la période.",
            "No invoiced or produced activity in the period.",
          )}
          icone="courbe"
        >
          <p>
            {t(
              "Élargissez la période ou vérifiez que des temps ont été validés.",
              "Widen the period or check that time has been approved.",
            )}
          </p>
        </EtatVide>
      ) : (
        <div className="mp-tableau-dense">
          <Tableau
            legende={t(
              `Rentabilité par ${libelleNiveauRentabilite(r.niveau).toLowerCase()}, montants en ${libelleDevise(r.devise)}`,
              `Profitability by ${niveau.toLowerCase()}, amounts in ${libelleDevise(r.devise)}`,
            )}
            legendeVisible
            lignes={r.elements}
            cleLigne={(l) => l.cle}
            colonnes={[
              {
                cle: "libelle",
                entete: niveau,
                rendu: (l) =>
                  r.niveau === "mission" ? (
                    <Link href={`/missions/${encodeURIComponent(l.cle)}/budget`}>{l.libelle}</Link>
                  ) : (
                    t(
                      `${l.libelle} (${l.nombre_missions} mission${l.nombre_missions > 1 ? "s" : ""})`,
                      `${l.libelle} (${l.nombre_missions} engagement${l.nombre_missions > 1 ? "s" : ""})`,
                    )
                  ),
              },
              {
                cle: "hon",
                entete: t("Honoraires", "Fees"),
                alignement: "droite",
                rendu: (l) => m(l.honoraires),
              },
              {
                cle: "couts",
                entete: t("Coûts internes", "Internal costs"),
                alignement: "droite",
                rendu: (l) => m(l.couts_internes),
              },
              {
                cle: "debours",
                entete: t("Débours non refacturés", "Non-re-billed expenses"),
                alignement: "droite",
                rendu: (l) => m(l.debours_non_refactures),
              },
              {
                cle: "st",
                entete: t("Sous-traitance", "Subcontracting"),
                alignement: "droite",
                rendu: (l) => m(l.sous_traitance),
              },
              {
                cle: "marge",
                entete: t("Marge", "Margin"),
                alignement: "droite",
                rendu: (l) => m(l.marge),
              },
              {
                cle: "taux",
                entete: t("Marge en %", "Margin %"),
                alignement: "droite",
                rendu: (l) => {
                  const s = statutMarge(l.taux_marge, l.marge, langue);
                  return (
                    <span className="mp-pile-inline">
                      <span>{formaterPourcentage(l.taux_marge, 1, langue)}</span>
                      <BadgeStatut tonalite={s.tonalite}>{s.libelle}</BadgeStatut>
                    </span>
                  );
                },
              },
              {
                cle: "budget",
                entete: t("Marge budgétée", "Budgeted margin"),
                alignement: "droite",
                rendu: (l) => m(l.budget.marge),
              },
              {
                cle: "jours",
                entete: t(
                  "Jours : budget / réalisé / atterrissage",
                  "Days: budget / actual / landing",
                ),
                alignement: "droite",
                rendu: (l) =>
                  `${formaterJours(l.budget.jours, langue)} / ${formaterJours(l.realise.jours, langue)} / ${formaterJours(l.atterrissage.jours, langue)}`,
              },
            ]}
          />
        </div>
      )}
    </>
  );
}
