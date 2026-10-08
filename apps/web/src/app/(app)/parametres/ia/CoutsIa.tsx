import Link from "next/link";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../components/ui/Carte";
import { EtatErreur, PaginationCurseur } from "../../../../components/ui/EtatListe";
import { Icone } from "../../../../components/ui/Icone";
import { Tableau } from "../../../../components/ui/Tableau";
import {
  formaterDate,
  formaterMontantMineur,
  formaterNombre,
  formaterPourcentage,
} from "../../../../lib/format";
import {
  decalerMois,
  etatPlafond,
  formaterMicroUsd,
  hrefCoutsIa,
  libelleMois,
  type CoutMissionIa,
  type CoutsIa,
  type PageIa,
} from "../../../../lib/ia";
import type { ChargementFacultatif } from "../../../../lib/ia-serveur";

/**
 * Coûts IA du cabinet (« ia.configurer » ET « finance.lire ») : mois choisi, douze derniers
 * mois, coût par mission rapporté à son prix (cible ≤ 5 %). Tous les chiffres viennent de
 * l'API ; l'écran les met seulement en forme. Sans droit (403), la section est masquée.
 */
export function CoutsIaSection({
  mois,
  moisCourant,
  couts,
  missions,
  curseurMissions,
}: {
  mois: string;
  moisCourant: string;
  couts: ChargementFacultatif<CoutsIa>;
  missions: ChargementFacultatif<PageIa<CoutMissionIa>>;
  curseurMissions: string | null;
}) {
  if (couts.etat === "refuse") return null;
  return (
    <Carte titre="Coûts IA" id="couts">
      {couts.etat === "erreur" ? (
        <EtatErreur
          titre="Les coûts IA n'ont pas pu être chargés."
          message={couts.message}
          hrefReessayer={hrefCoutsIa(mois)}
        />
      ) : (
        <div className="mp-pile">
          <NavigationMois mois={mois} moisCourant={moisCourant} />
          <ResumeMois c={couts.donnees} />
          <Tableau
            legende="Coût IA des douze derniers mois"
            legendeVisible
            colonnes={[
              { cle: "mois", entete: "Mois", rendu: (l) => libelleMois(l.mois) },
              {
                cle: "appels",
                entete: "Appels facturés",
                alignement: "droite",
                rendu: (l) => formaterNombre(l.appels, 0),
              },
              {
                cle: "cout",
                entete: "Coût estimé",
                alignement: "droite",
                rendu: (l) => formaterMicroUsd(l.cout_micro_usd),
              },
            ]}
            lignes={couts.donnees.historique}
            cleLigne={(l) => l.mois}
          />
        </div>
      )}
      {missions.etat === "ok" ? (
        <CoutsMissions
          page={missions.donnees}
          seuil={couts.etat === "ok" ? couts.donnees.seuil_ratio_mission : null}
          mois={mois}
          curseur={curseurMissions}
        />
      ) : missions.etat === "erreur" ? (
        <EtatErreur
          titre="Le coût IA par mission n'a pas pu être chargé."
          message={missions.message}
          hrefReessayer={hrefCoutsIa(mois)}
        />
      ) : null}
    </Carte>
  );
}

function NavigationMois({ mois, moisCourant }: { mois: string; moisCourant: string }) {
  return (
    <nav className="mp-ia-mois" aria-label="Choix du mois">
      <Link className="mp-pagination__lien" href={hrefCoutsIa(decalerMois(mois, -1))}>
        <Icone nom="chevronGauche" taille={18} />
        <span>Mois précédent</span>
      </Link>
      <h3 className="mp-ia-mois__titre">{libelleMois(mois)}</h3>
      {mois < moisCourant ? (
        <Link className="mp-pagination__lien" href={hrefCoutsIa(decalerMois(mois, 1))}>
          <span>Mois suivant</span>
          <Icone nom="chevronDroit" taille={18} />
        </Link>
      ) : (
        <span aria-hidden="true" />
      )}
    </nav>
  );
}

function ResumeMois({ c }: { c: CoutsIa }) {
  const etat = etatPlafond(c.part_plafond);
  const taux = c.taux_conversion;
  return (
    <>
      <dl className="mp-liste-def">
        <div>
          <dt>Coût estimé du mois</dt>
          <dd>{formaterMicroUsd(c.cout_micro_usd)}</dd>
        </div>
        <div>
          <dt>Appels facturés</dt>
          <dd>{formaterNombre(c.appels, 0)}</dd>
        </div>
        <div>
          <dt>Plafond mensuel du cabinet</dt>
          <dd>{formaterMicroUsd(c.plafond_mensuel_micro_usd)}</dd>
        </div>
        {c.plafond_effectif_micro_usd !== c.plafond_mensuel_micro_usd ? (
          <div>
            <dt>Plafond appliqué</dt>
            <dd>{`${formaterMicroUsd(c.plafond_effectif_micro_usd)} (borné par l'opérateur pour la clé de la plateforme)`}</dd>
          </div>
        ) : null}
        <div>
          <dt>Part du plafond appliqué consommée</dt>
          <dd className="mp-badges">
            <span>{formaterPourcentage(c.part_plafond)}</span>
            <BadgeStatut tonalite={etat.tonalite}>{etat.libelle}</BadgeStatut>
          </dd>
        </div>
      </dl>
      <p className="mp-texte-petit mp-texte-doux">
        {`Coûts estimés d'après les tarifs publiés des modèles (en dollars US). Conversion vers la devise des missions au taux de départ du ${formaterDate(taux.date)}${taux.a_valider ? ", à valider par le métier" : ""}.`}
      </p>
    </>
  );
}

function CoutsMissions({
  page,
  seuil,
  mois,
  curseur,
}: {
  page: PageIa<CoutMissionIa>;
  seuil: number | null;
  mois: string;
  curseur: string | null;
}) {
  const libelleSeuil = seuil === null ? "le seuil" : formaterPourcentage(seuil, 0);
  return (
    <div className="mp-pile">
      <Tableau
        legende="Coût IA cumulé par mission"
        legendeVisible
        messageVide="Aucune mission n'a encore consommé d'IA."
        colonnes={[
          {
            cle: "mission",
            entete: "Mission",
            rendu: (l) => (
              <Link href={`/missions/${l.mission_id}`}>
                {l.intitule ?? "Mission sans intitulé"}
              </Link>
            ),
          },
          {
            cle: "appels",
            entete: "Appels",
            alignement: "droite",
            rendu: (l) => formaterNombre(l.appels, 0),
          },
          {
            cle: "cout",
            entete: "Coût estimé",
            alignement: "droite",
            rendu: (l) =>
              `${formaterMicroUsd(l.cout_micro_usd)} (${formaterMontantMineur(l.cout_devise, l.devise)})`,
          },
          {
            cle: "prix",
            entete: "Prix de la mission",
            alignement: "droite",
            rendu: (l) =>
              l.prix_mission === null
                ? "Budget non figé"
                : formaterMontantMineur(l.prix_mission, l.devise),
          },
          {
            cle: "ratio",
            entete: "Coût / prix",
            rendu: (l) =>
              l.depasse_seuil === null ? (
                <BadgeStatut tonalite="neutre">Non calculable</BadgeStatut>
              ) : (
                <BadgeStatut tonalite={l.depasse_seuil ? "danger" : "succes"}>
                  {`${formaterPourcentage(l.ratio_cout_prix, 2)} : ${l.depasse_seuil ? `au-delà de ${libelleSeuil}` : `sous ${libelleSeuil}`}`}
                </BadgeStatut>
              ),
          },
        ]}
        lignes={page.elements}
        cleLigne={(l) => l.mission_id}
      />
      <PaginationCurseur
        libelle="Pages du coût par mission"
        hrefSuivante={page.curseur_suivant ? hrefCoutsIa(mois, page.curseur_suivant) : null}
        hrefDebut={curseur ? hrefCoutsIa(mois) : null}
      />
    </div>
  );
}
