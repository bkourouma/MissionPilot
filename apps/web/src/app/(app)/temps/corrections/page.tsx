import type { Metadata } from "next";
import { aPermission } from "@missionpilot/shared";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../lib/api-serveur";
import { formaterDate, formaterDateHeure, formaterJours } from "../../../../lib/format";
import { aujourdhuiIso } from "../../../../lib/semaine";
import { exigerPermission } from "../../../../lib/session";
import {
  peutDeciderCorrection,
  STATUT_CORRECTION,
  type Correction,
} from "../../../../lib/temps-admin";
import type { SemaineTemps } from "../../../../lib/temps";
import { DecisionCorrection, DemandeCorrection } from "./Corrections";

export const metadata: Metadata = { title: "Corrections de temps" };

const CURSEUR = /^[A-Za-z0-9_=-]{1,500}$/;

export default async function PageCorrections({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { utilisateur } = await exigerPermission("temps.saisir");
  const brut = (await searchParams).curseur;
  const curseur = typeof brut === "string" && CURSEUR.test(brut) ? brut : "";
  const [semaine, liste] = await Promise.all([
    chargerServeur<SemaineTemps>("/api/feuilles-temps/semaine"),
    chargerServeur<{ elements: Correction[]; curseur_suivant: string | null }>(
      `/api/temps/corrections?limite=30${curseur ? `&curseur=${encodeURIComponent(curseur)}` : ""}`,
    ),
  ]);
  const moi = semaine.ok ? semaine.donnees.collaborateur : null;
  const decideur = aPermission(utilisateur.roles, "temps.cloturer");

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Corrections de temps"
        soustitre="Des temps validés ou d'un mois clôturé ne se modifient plus : chaque correction est demandée avec un motif, puis validée par un gestionnaire, et reste tracée."
      />
      {semaine.ok && moi ? (
        <Carte titre="Demander une correction de mes temps">
          <DemandeCorrection
            collaborateurId={moi.id}
            unite={semaine.donnees.unite_saisie_temps}
            activites={semaine.donnees.activites}
            aujourdhui={aujourdhuiIso()}
          />
        </Carte>
      ) : null}

      <section aria-labelledby="titre-corrections" className="mp-pile">
        <h2 id="titre-corrections" className="mp-section__titre">
          {decideur ? "Demandes de correction du cabinet" : "Mes demandes de correction"}
        </h2>
        {!liste.ok ? (
          <EtatErreur
            titre="Les corrections n'ont pas pu être chargées."
            message={liste.message}
            hrefReessayer="/temps/corrections"
          />
        ) : liste.donnees.elements.length === 0 ? (
          <EtatVide titre="Aucune demande de correction." icone="succes" />
        ) : (
          <ul className="mp-liste-cartes">
            {liste.donnees.elements.map((k) => {
              const quoi = k.tache_libelle ?? k.activite_libelle ?? "Ligne";
              const libelle = `${k.collaborateur_nom}, ${quoi}, ${formaterDate(k.date)}`;
              const statut = STATUT_CORRECTION[k.statut];
              return (
                <li key={k.id}>
                  <Carte
                    niveauTitre={3}
                    titre={`${k.collaborateur_nom} · ${formaterDate(k.date)}`}
                    actions={<BadgeStatut tonalite={statut.tonalite}>{statut.libelle}</BadgeStatut>}
                  >
                    <div className="mp-pile">
                      <dl className="mp-liste-def mp-liste-def--compacte">
                        <div>
                          <dt>Ligne</dt>
                          <dd>{quoi}</dd>
                        </div>
                        <div>
                          <dt>Valeur</dt>
                          <dd>{`${formaterJours(k.ancienne_valeur)} → ${formaterJours(k.nouvelle_valeur)}`}</dd>
                        </div>
                        <div>
                          <dt>Motif</dt>
                          <dd className="mp-texte-preserve">{k.motif}</dd>
                        </div>
                        <div>
                          <dt>Demandée le</dt>
                          <dd>{formaterDateHeure(k.demandee_le)}</dd>
                        </div>
                        {k.motif_rejet ? (
                          <div>
                            <dt>Motif du rejet</dt>
                            <dd className="mp-texte-preserve">{k.motif_rejet}</dd>
                          </div>
                        ) : null}
                      </dl>
                      {peutDeciderCorrection(
                        k,
                        utilisateur.roles,
                        utilisateur.id,
                        moi?.id ?? null,
                        k.collaborateur_id,
                      ) ? (
                        <DecisionCorrection id={k.id} libelle={libelle} />
                      ) : null}
                    </div>
                  </Carte>
                </li>
              );
            })}
          </ul>
        )}
        {liste.ok ? (
          <PaginationCurseur
            libelle="Pages des corrections"
            hrefSuivante={
              liste.donnees.curseur_suivant
                ? `/temps/corrections?curseur=${encodeURIComponent(liste.donnees.curseur_suivant)}`
                : null
            }
            hrefDebut={curseur ? "/temps/corrections" : null}
          />
        ) : null}
      </section>
    </div>
  );
}
