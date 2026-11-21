import type { Metadata } from "next";
import { creerTraduire } from "@missionpilot/shared";
import { notFound } from "next/navigation";
import { TableauLignes } from "../../../../../components/temps/TableauLignes";
import { Alerte } from "../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../components/ui/EtatListe";
import { obtenirLangue } from "../../../../../lib/i18n/serveur";
import { chargerServeur } from "../../../../../lib/api-serveur";
import { formaterDateHeure } from "../../../../../lib/format";
import { estIdentifiant } from "../../../../../lib/identifiant";
import { joursDeLaSemaine, libelleSemaine, ajouterJoursIso } from "../../../../../lib/semaine";
import { exigerPermission } from "../../../../../lib/session";
import type { ParametresTemps } from "../../../../../lib/temps-admin";
import {
  lignesDePartie,
  peutDeciderPartie,
  statutFeuille,
  statutPartie,
  type Feuille,
} from "../../../../../lib/temps";
import { DecisionPartie } from "./DecisionPartie";

export async function generateMetadata(): Promise<Metadata> {
  const t = creerTraduire(await obtenirLangue());
  return { title: t("Feuille de temps à examiner", "Timesheet to review") };
}

export default async function PageFeuille({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const langue = await obtenirLangue();
  const t = creerTraduire(langue);
  if (!estIdentifiant(id)) notFound();
  const { utilisateur } = await exigerPermission("temps.saisir");
  const [r, p] = await Promise.all([
    chargerServeur<Feuille>(`/api/feuilles-temps/${id}`),
    chargerServeur<ParametresTemps>("/api/temps/parametres"),
  ]);
  if (!r.ok && r.statut === 404) notFound();
  const retour = {
    href: "/temps/validation",
    libelle: t("Feuilles à valider", "Timesheets to approve"),
  };
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage titre={t("Feuille de temps", "Timesheet")} retour={retour} />
        <EtatErreur
          titre={t("La feuille n'a pas pu être chargée.", "The timesheet could not be loaded.")}
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
        soustitre={libelleSemaine(f.semaine, ajouterJoursIso(f.semaine, 6), langue)}
        badges={
          <BadgeStatut tonalite={statutFeuille(f.statut, langue).tonalite}>
            {statutFeuille(f.statut, langue).libelle}
          </BadgeStatut>
        }
      />
      {auteur ? (
        <Alerte
          tonalite="info"
          titre={t("C'est votre feuille", "This is your timesheet")}
          annonce="aucune"
        >
          <p>
            {t(
              "Sa validation revient à vos chefs de mission : vous ne pouvez pas la valider vous-même.",
              "Its approval belongs to your engagement managers: you cannot approve it yourself.",
            )}
          </p>
        </Alerte>
      ) : null}
      {f.vue_partielle ? (
        <Alerte tonalite="info" annonce="aucune">
          <p>
            {t(
              "Seules les parties que vous pouvez examiner (vos missions) sont affichées.",
              "Only the parts you can review (your engagements) are shown.",
            )}
          </p>
        </Alerte>
      ) : null}
      {f.soumise_le ? (
        <p className="mp-texte-doux">
          {t(
            `Soumise le ${formaterDateHeure(f.soumise_le, "Africa/Abidjan", langue)}${f.cycle > 1 ? ` (envoi n° ${f.cycle}, après rejet)` : ""}.`,
            `Submitted on ${formaterDateHeure(f.soumise_le, "Africa/Abidjan", langue)}${f.cycle > 1 ? ` (submission no. ${f.cycle}, after rejection)` : ""}.`,
          )}
        </p>
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
                <BadgeStatut tonalite={statutPartie(partie.statut, langue).tonalite}>
                  {statutPartie(partie.statut, langue).libelle}
                </BadgeStatut>
              ) : null
            }
          >
            <div className="mp-pile">
              <TableauLignes
                legende={t(`Temps : ${partie.intitule}`, `Time: ${partie.intitule}`)}
                lignes={lignes}
                jours={jours}
                unite={unite}
              />
              {partie.motif ? (
                <Alerte tonalite="attention" annonce="aucune" titre={t("Motif", "Reason")}>
                  <p className="mp-texte-preserve">{partie.motif}</p>
                </Alerte>
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
