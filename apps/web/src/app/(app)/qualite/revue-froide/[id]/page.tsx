import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import "../../../../../components/qualite/froide.css";
import "../../../../../components/qualite/qualite.css";
import { FroideClotureCampagne } from "../../../../../components/qualite/FroideClotureCampagne";
import { FroideAffectation } from "../../../../../components/qualite/FroideAffectation";
import { FroideListeActions } from "../../../../../components/qualite/FroideListeActions";
import { FroidePlanFormulaire } from "../../../../../components/qualite/FroidePlanFormulaire";
import { FroideVerification } from "../../../../../components/qualite/FroideVerification";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../../components/ui/EtatListe";
import { Tableau, type ColonneTableau } from "../../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../../lib/api-serveur";
import { formaterDate } from "../../../../../lib/format";
import { empreinteCourte } from "../../../../../lib/qualite";
import {
  cheminCampagne,
  cheminPlan,
  estUuid,
  formaterScore,
  formaterTauxRealisation,
  HREF_REVUE_FROIDE,
  hrefCampagne,
  hrefEchantillon,
  libelleConclusion,
  libelleStatutCampagne,
  libelleStatutEchantillon,
  STRATES_LIBELLES,
  texteProgression,
  tonaliteConclusion,
  tonaliteStatutEchantillon,
  type CampagneDetail,
  type LigneEchantillon,
  type PlanAmelioration,
} from "../../../../../lib/qualite-froide";
import {
  chargerConstatsCampagne,
  chargerDirecteurs,
  chargerResponsables,
  chargerTypesPourTirage,
  exigerGestionFroide,
} from "../../../../../lib/qualite-froide-serveur";

export const metadata: Metadata = { title: "Campagne de revue à froid" };

/**
 * Détail d'une campagne de revue à froid (associé) : paramètres du tirage et sa vérification,
 * échantillon et affectation des relecteurs indépendants, clôture, puis plan d'amélioration.
 */
export default async function PageCampagneFroide({ params }: { params: Promise<{ id: string }> }) {
  const session = await exigerGestionFroide();
  const { id } = await params;
  if (!estUuid(id)) notFound();
  const [r, plan] = await Promise.all([
    chargerServeur<CampagneDetail>(cheminCampagne(id)),
    chargerServeur<PlanAmelioration>(cheminPlan(id)),
  ]);
  if (!r.ok && r.statut === 404) notFound();
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage
          titre="Campagne de revue à froid"
          retour={{ href: HREF_REVUE_FROIDE, libelle: "Revue à froid" }}
        />
        <EtatErreur
          titre="La campagne n'a pas pu être chargée."
          message={r.message}
          hrefReessayer={hrefCampagne(id)}
        />
      </div>
    );
  }
  const c = r.donnees;
  const [responsables, types, directeurs, constats] = await Promise.all([
    chargerResponsables(session),
    chargerTypesPourTirage(session),
    chargerDirecteurs(session),
    chargerConstatsCampagne(c.echantillon),
  ]);
  const noms = (ids: string[], options: { valeur: string; libelle: string }[]) =>
    ids.length === 0
      ? "Tous"
      : ids.map((x) => options.find((o) => o.valeur === x)?.libelle ?? "Non listé").join(", ");
  const ouverte = c.statut === "ouverte";

  const colonnes: ColonneTableau<LigneEchantillon>[] = [
    {
      cle: "mission",
      entete: "Mission",
      rendu: (l) => (
        <Link href={hrefEchantillon(l.id)} className="mp-lien-ligne">
          {l.mission_intitule}
        </Link>
      ),
    },
    { cle: "client_nom", entete: "Client" },
    { cle: "directeur_nom", entete: "Directeur" },
    {
      cle: "mission_cloturee_le",
      entete: "Clôture",
      rendu: (l) => formaterDate(l.mission_cloturee_le),
    },
    {
      cle: "relecteur",
      entete: "Relecteur",
      rendu: (l) =>
        l.relecteur_nom ??
        (ouverte && l.statut === "a_affecter" ? (
          <FroideAffectation echantillonId={l.id} mission={l.mission_intitule} />
        ) : (
          "—"
        )),
    },
    {
      cle: "statut",
      entete: "Statut",
      rendu: (l) => (
        <BadgeStatut tonalite={tonaliteStatutEchantillon(l.statut)}>
          {libelleStatutEchantillon(l.statut)}
        </BadgeStatut>
      ),
    },
    {
      cle: "resultat",
      entete: "Score et conclusion",
      rendu: (l) =>
        l.conclusion ? (
          <>
            {formaterScore(l.score)}{" "}
            <BadgeStatut tonalite={tonaliteConclusion(l.conclusion)}>
              {libelleConclusion(l.conclusion)}
            </BadgeStatut>
          </>
        ) : (
          "—"
        ),
    },
  ];

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={c.intitule}
        soustitre={`Créée le ${formaterDate(c.cree_le)}${c.cree_par_nom ? ` par ${c.cree_par_nom}` : ""} · ${texteProgression(c.progression.terminees, c.progression.total, "revues terminées")}`}
        retour={{ href: HREF_REVUE_FROIDE, libelle: "Revue à froid" }}
        badges={
          <BadgeStatut tonalite={ouverte ? "attention" : "neutre"}>
            {libelleStatutCampagne(c.statut)}
          </BadgeStatut>
        }
      />

      <Carte titre="Tirage de l'échantillon">
        <div className="mp-froide__pile">
          <dl className="mp-froide__def">
            <dt>Période de clôture</dt>
            <dd>
              du {formaterDate(c.criteres.periode_debut)} au {formaterDate(c.criteres.periode_fin)}
            </dd>
            <dt>Types de mission</dt>
            <dd>{noms(c.criteres.types_mission_ids, types)}</dd>
            <dt>Directeurs</dt>
            <dd>{noms(c.criteres.directeur_ids, directeurs)}</dd>
            <dt>Stratification</dt>
            <dd>
              {c.criteres.stratifier_par ? STRATES_LIBELLES[c.criteres.stratifier_par] : "Aucune"}
            </dd>
            <dt>Missions déjà revues</dt>
            <dd>
              {c.criteres.exclure_deja_revues ? "Exclues du tirage" : "Incluses dans le tirage"}
            </dd>
            <dt>Taille</dt>
            <dd>
              {c.taille_obtenue} mission(s) tirée(s) sur {c.taille_demandee} demandée(s)
            </dd>
            <dt>Population tirable</dt>
            <dd>{c.population_taille} mission(s) clôturée(s)</dd>
            <dt>Graine</dt>
            <dd>{c.graine}</dd>
            <dt>Empreinte de la population</dt>
            <dd title={c.empreinte_population}>{empreinteCourte(c.empreinte_population)}</dd>
          </dl>
          <FroideVerification campagneId={c.id} />
        </div>
      </Carte>

      <section
        aria-labelledby="titre-echantillon"
        className="mp-froide__pile mp-froide__echantillon"
      >
        <h2 id="titre-echantillon" className="mp-section__titre">
          Échantillon
        </h2>
        <Tableau
          legende="Échantillon de la campagne"
          colonnes={colonnes}
          lignes={c.echantillon}
          cleLigne={(l) => l.id}
          messageVide="Aucune mission n'a été tirée : la population ne contenait aucune mission clôturée correspondant aux critères."
        />
      </section>

      {ouverte ? (
        <Carte titre="Clôture de la campagne">
          <div className="mp-froide__pile">
            <p>
              La campagne peut être close lorsque toutes les revues sont terminées (
              {texteProgression(c.progression.terminees, c.progression.total, "terminées")}).
            </p>
            <FroideClotureCampagne campagneId={c.id} />
          </div>
        </Carte>
      ) : (
        <p className="mp-texte-doux">Campagne close le {formaterDate(c.cloturee_le)}.</p>
      )}

      <section aria-labelledby="titre-plan" className="mp-froide__pile">
        <h2 id="titre-plan" className="mp-section__titre">
          Plan d&apos;amélioration
        </h2>
        {!plan.ok ? (
          <EtatErreur
            titre="Le plan n'a pas pu être chargé."
            message={plan.message}
            hrefReessayer={hrefCampagne(id)}
          />
        ) : (
          <>
            <ul
              className="mp-froide__indicateurs"
              aria-label="Indicateurs du plan, calculés par le moteur"
            >
              <li className="mp-froide__indicateur">
                <strong>{formaterTauxRealisation(plan.donnees.etat.taux_realisation)}</strong>
                <span>
                  réalisation ({plan.donnees.etat.faites} faite(s) sur {plan.donnees.etat.total})
                </span>
              </li>
              <li className="mp-froide__indicateur">
                <strong>{plan.donnees.etat.en_retard}</strong>
                <span>en retard</span>
              </li>
              <li className="mp-froide__indicateur">
                <strong>{plan.donnees.etat.en_cours}</strong>
                <span>en cours ({plan.donnees.etat.a_faire} à faire)</span>
              </li>
              <li className="mp-froide__indicateur">
                <strong>{formaterDate(plan.donnees.etat.prochaine_echeance)}</strong>
                <span>prochaine échéance</span>
              </li>
            </ul>
            {plan.donnees.actions.length === 0 ? (
              <EtatVide titre="Aucune action au plan d'amélioration." icone="signature">
                <p>Ajoutez une action à partir d&apos;un constat ou librement.</p>
              </EtatVide>
            ) : (
              <FroideListeActions
                actions={plan.donnees.actions}
                utilisateurId={session.utilisateur.id}
                peutGerer
                responsables={responsables}
              />
            )}
          </>
        )}
        <Carte titre="Ajouter une action" niveauTitre={3}>
          <FroidePlanFormulaire campagneId={c.id} responsables={responsables} constats={constats} />
        </Carte>
      </section>
    </div>
  );
}
