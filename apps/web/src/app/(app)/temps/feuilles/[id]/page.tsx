import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TableauLignes } from "../../../../../components/temps/TableauLignes";
import { Alerte } from "../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../lib/api-serveur";
import { formaterDateHeure } from "../../../../../lib/format";
import { estIdentifiant } from "../../../../../lib/identifiant";
import { joursDeLaSemaine, libelleSemaine, ajouterJoursIso } from "../../../../../lib/semaine";
import { exigerPermission } from "../../../../../lib/session";
import type { ParametresTemps } from "../../../../../lib/temps-admin";
import {
  lignesDePartie,
  peutDeciderPartie,
  STATUT_FEUILLE,
  STATUT_PARTIE,
  type Feuille,
} from "../../../../../lib/temps";
import { DecisionPartie } from "./DecisionPartie";

export const metadata: Metadata = { title: "Feuille de temps à examiner" };

export default async function PageFeuille({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();
  const { utilisateur } = await exigerPermission("temps.saisir");
  const [r, p] = await Promise.all([
    chargerServeur<Feuille>(`/api/feuilles-temps/${id}`),
    chargerServeur<ParametresTemps>("/api/temps/parametres"),
  ]);
  if (!r.ok && r.statut === 404) notFound();
  const retour = { href: "/temps/validation", libelle: "Feuilles à valider" };
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage titre="Feuille de temps" retour={retour} />
        <EtatErreur
          titre="La feuille n'a pas pu être chargée."
          message={r.message}
          hrefReessayer={`/temps/feuilles/${id}`}
        />
      </div>
    );
  }
  const f = r.donnees;
  const unite = p.ok ? p.donnees.unite_saisie_temps : "demi_journee";
  const jours = joursDeLaSemaine(f.semaine);
  const auteur = f.auteur_id === utilisateur.id;

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={f.collaborateur_nom}
        retour={retour}
        soustitre={libelleSemaine(f.semaine, ajouterJoursIso(f.semaine, 6))}
        badges={
          <BadgeStatut tonalite={STATUT_FEUILLE[f.statut].tonalite}>
            {STATUT_FEUILLE[f.statut].libelle}
          </BadgeStatut>
        }
      />
      {auteur ? (
        <Alerte tonalite="info" titre="C'est votre feuille" annonce="aucune">
          <p>
            Sa validation revient à vos chefs de mission : vous ne pouvez pas la valider vous-même.
          </p>
        </Alerte>
      ) : null}
      {f.vue_partielle ? (
        <p className="mp-texte-doux">
          Seules les parties que vous pouvez examiner (vos missions) sont affichées.
        </p>
      ) : null}
      {f.soumise_le ? (
        <p className="mp-texte-doux">{`Soumise le ${formaterDateHeure(f.soumise_le)}${f.cycle > 1 ? ` (envoi n° ${f.cycle}, après rejet)` : ""}.`}</p>
      ) : null}

      {f.parties.map((partie) => {
        const lignes = lignesDePartie(f.lignes, partie.mission_id);
        const decider = !auteur && peutDeciderPartie(f, partie, utilisateur.id);
        return (
          <Carte
            key={partie.mission_id ?? "interne"}
            titre={partie.intitule}
            actions={
              partie.statut ? (
                <BadgeStatut tonalite={STATUT_PARTIE[partie.statut].tonalite}>
                  {STATUT_PARTIE[partie.statut].libelle}
                </BadgeStatut>
              ) : null
            }
          >
            <div className="mp-pile">
              <TableauLignes
                legende={`Temps : ${partie.intitule}`}
                lignes={lignes}
                jours={jours}
                unite={unite}
              />
              {partie.motif ? (
                <p className="mp-texte-preserve">{`Motif : ${partie.motif}`}</p>
              ) : null}
              {decider ? (
                <DecisionPartie
                  feuilleId={f.id}
                  missionId={partie.mission_id}
                  intitule={partie.intitule}
                />
              ) : null}
            </div>
          </Carte>
        );
      })}
    </div>
  );
}
