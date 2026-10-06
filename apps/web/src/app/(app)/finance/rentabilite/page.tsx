import Link from "next/link";
import type { Metadata } from "next";
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
} from "../../../../lib/format";
import { statutMarge } from "../../../../lib/indicateurs";
import {
  lireFiltresRentabilite,
  NIVEAU_RENTABILITE_LIBELLES,
  OPTIONS_NIVEAUX_RENTABILITE,
  RAISON_EXCLUSION,
  requeteRentabilite,
  type ReponseRentabilite,
} from "../../../../lib/rentabilite";
import { exigerPermission } from "../../../../lib/session";

export const metadata: Metadata = { title: "Rentabilité" };

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
  const f = lireFiltresRentabilite(await searchParams);
  const requete = requeteRentabilite(f);
  const r = await chargerServeur<ReponseRentabilite>(`/api/finance/rentabilite?${requete}`);

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Rentabilité"
        soustitre="Honoraires facturés, coûts internes, débours non refacturés, sous-traitance et marge sur la période, avec le budget, le réalisé et l'atterrissage en jours. Données confidentielles du cabinet."
      />
      <form
        method="get"
        action="/finance/rentabilite"
        className="mp-filtres"
        role="search"
        aria-label="Période et regroupement"
      >
        <div className="mp-grille-champs mp-grille-champs--filtres">
          <Select
            libelle="Regrouper par"
            name="niveau"
            options={OPTIONS_NIVEAUX_RENTABILITE}
            defaultValue={f.niveau}
          />
          <Champ libelle="Du" type="date" name="du" defaultValue={f.du} required />
          <Champ
            libelle="Au"
            type="date"
            name="au"
            defaultValue={f.au}
            required
            aide="Période de 366 jours au plus."
          />
        </div>
        <div className="mp-actions-formulaire">
          <button type="submit" className={classesBouton("primaire")}>
            <Icone nom="entonnoir" />
            <span>Afficher</span>
          </button>
        </div>
      </form>
      {f.corrigee ? (
        <Alerte tonalite="attention" annonce="status">
          <p>
            Période invalide ou de plus de 366 jours : la période par défaut (année en cours) est
            affichée.
          </p>
        </Alerte>
      ) : null}
      {!r.ok ? (
        <EtatErreur
          titre="La rentabilité n'a pas pu être calculée."
          message={r.message}
          hrefReessayer={`/finance/rentabilite?${requete}`}
        />
      ) : (
        <Resultats r={r.donnees} />
      )}
    </div>
  );
}

function Resultats({ r }: { r: ReponseRentabilite }) {
  const m = (v: number) => formaterMontantMineur(v, r.devise);
  const statutTotal = statutMarge(r.total.taux_marge, r.total.marge);
  return (
    <>
      <Carte titre={`Total du ${formaterDate(r.du)} au ${formaterDate(r.au)}`}>
        <ul className="mp-totaux">
          <li className="mp-totaux__element">
            <span className="mp-totaux__libelle">Honoraires</span>
            <span className="mp-totaux__valeur">{m(r.total.honoraires)}</span>
          </li>
          <li className="mp-totaux__element">
            <span className="mp-totaux__libelle">Coûts internes</span>
            <span className="mp-totaux__valeur">{m(r.total.couts_internes)}</span>
          </li>
          <li className="mp-totaux__element">
            <span className="mp-totaux__libelle">Débours non refacturés</span>
            <span className="mp-totaux__valeur">{m(r.total.debours_non_refactures)}</span>
          </li>
          <li className="mp-totaux__element">
            <span className="mp-totaux__libelle">Sous-traitance</span>
            <span className="mp-totaux__valeur">{m(r.total.sous_traitance)}</span>
          </li>
          <li className="mp-totaux__element">
            <span className="mp-totaux__libelle">Marge</span>
            <span className="mp-totaux__valeur">{m(r.total.marge)}</span>
            <span>
              {`${formaterPourcentage(r.total.taux_marge)} `}
              <BadgeStatut tonalite={statutTotal.tonalite}>{statutTotal.libelle}</BadgeStatut>
            </span>
          </li>
        </ul>
        {r.missions_exclues.length > 0 ? (
          <p className="mp-texte-doux">
            {`${r.missions_exclues.length} mission(s) exclue(s) : ${RAISON_EXCLUSION.TAUX_CHANGE_ABSENT}.`}
          </p>
        ) : null}
      </Carte>
      {r.elements.length === 0 ? (
        <EtatVide titre="Aucune activité facturée ni produite sur la période." icone="courbe">
          <p>Élargissez la période ou vérifiez que des temps ont été validés.</p>
        </EtatVide>
      ) : (
        <Tableau
          legende={`Rentabilité par ${NIVEAU_RENTABILITE_LIBELLES[r.niveau].toLowerCase()}, montants en ${r.devise}`}
          legendeVisible
          lignes={r.elements}
          cleLigne={(l) => l.cle}
          colonnes={[
            {
              cle: "libelle",
              entete: NIVEAU_RENTABILITE_LIBELLES[r.niveau],
              rendu: (l) =>
                r.niveau === "mission" ? (
                  <Link href={`/missions/${encodeURIComponent(l.cle)}/budget`}>{l.libelle}</Link>
                ) : (
                  `${l.libelle} (${l.nombre_missions} mission${l.nombre_missions > 1 ? "s" : ""})`
                ),
            },
            {
              cle: "hon",
              entete: "Honoraires",
              alignement: "droite",
              rendu: (l) => m(l.honoraires),
            },
            {
              cle: "couts",
              entete: "Coûts internes",
              alignement: "droite",
              rendu: (l) => m(l.couts_internes),
            },
            {
              cle: "debours",
              entete: "Débours non refacturés",
              alignement: "droite",
              rendu: (l) => m(l.debours_non_refactures),
            },
            {
              cle: "st",
              entete: "Sous-traitance",
              alignement: "droite",
              rendu: (l) => m(l.sous_traitance),
            },
            { cle: "marge", entete: "Marge", alignement: "droite", rendu: (l) => m(l.marge) },
            {
              cle: "taux",
              entete: "Marge en %",
              alignement: "droite",
              rendu: (l) => {
                const s = statutMarge(l.taux_marge, l.marge);
                return (
                  <span className="mp-pile-inline">
                    <span>{formaterPourcentage(l.taux_marge)}</span>
                    <BadgeStatut tonalite={s.tonalite}>{s.libelle}</BadgeStatut>
                  </span>
                );
              },
            },
            {
              cle: "budget",
              entete: "Marge budgétée",
              alignement: "droite",
              rendu: (l) => m(l.budget.marge),
            },
            {
              cle: "jours",
              entete: "Jours : budget / réalisé / atterrissage",
              alignement: "droite",
              rendu: (l) =>
                `${formaterJours(l.budget.jours)} / ${formaterJours(l.realise.jours)} / ${formaterJours(l.atterrissage.jours)}`,
            },
          ]}
        />
      )}
    </>
  );
}
