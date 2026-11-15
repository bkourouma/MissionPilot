import type { Metadata } from "next";
import { aPermission, creerTraduire } from "@missionpilot/shared";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../components/ui/EtatListe";
import { obtenirLangue } from "../../../../lib/i18n/serveur";
import { chargerServeur } from "../../../../lib/api-serveur";
import { formaterDate, formaterDateHeure, formaterJours } from "../../../../lib/format";
import { aujourdhuiIso } from "../../../../lib/semaine";
import { exigerPermission } from "../../../../lib/session";
import {
  peutDeciderCorrection,
  statutCorrection,
  type Correction,
} from "../../../../lib/temps-admin";
import type { SemaineTemps } from "../../../../lib/temps";
import { DecisionCorrection, DemandeCorrection } from "./Corrections";

export async function generateMetadata(): Promise<Metadata> {
  const t = creerTraduire(await obtenirLangue());
  return { title: t("Corrections de temps", "Time corrections") };
}

const CURSEUR = /^[A-Za-z0-9_=-]{1,500}$/;

export default async function PageCorrections({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { utilisateur } = await exigerPermission("temps.saisir");
  const langue = await obtenirLangue();
  const t = creerTraduire(langue);
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
        titre={t("Corrections de temps", "Time corrections")}
        soustitre={t(
          "Des temps validés ou d'un mois clôturé ne se modifient plus : chaque correction est demandée avec un motif, puis validée par un gestionnaire, et reste tracée.",
          "Approved time or time in a closed month can no longer be edited: each correction is requested with a reason, then approved by a manager, and stays tracked.",
        )}
      />
      {semaine.ok && moi ? (
        <Carte titre={t("Demander une correction de mes temps", "Request a correction of my time")}>
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
          {decideur
            ? t("Demandes de correction du cabinet", "Firm correction requests")
            : t("Mes demandes de correction", "My correction requests")}
        </h2>
        {!liste.ok ? (
          <EtatErreur
            titre={t(
              "Les corrections n'ont pas pu être chargées.",
              "Corrections could not be loaded.",
            )}
            message={liste.message}
            hrefReessayer="/temps/corrections"
          />
        ) : liste.donnees.elements.length === 0 ? (
          <EtatVide
            titre={t("Aucune demande de correction.", "No correction requests.")}
            icone="succes"
          />
        ) : (
          <ul className="mp-liste-cartes">
            {liste.donnees.elements.map((k) => {
              const quoi = k.tache_libelle ?? k.activite_libelle ?? t("Ligne", "Row");
              const libelle = `${k.collaborateur_nom}, ${quoi}, ${formaterDate(k.date, "UTC", langue)}`;
              const statut = statutCorrection(k.statut, langue);
              return (
                <li key={k.id}>
                  <Carte
                    niveauTitre={3}
                    titre={`${k.collaborateur_nom} · ${formaterDate(k.date, "UTC", langue)}`}
                    actions={<BadgeStatut tonalite={statut.tonalite}>{statut.libelle}</BadgeStatut>}
                  >
                    <div className="mp-pile">
                      <dl className="mp-liste-def mp-liste-def--compacte">
                        <div>
                          <dt>{t("Ligne", "Row")}</dt>
                          <dd>{quoi}</dd>
                        </div>
                        <div>
                          <dt>{t("Valeur", "Value")}</dt>
                          <dd>{`${formaterJours(k.ancienne_valeur, langue)} → ${formaterJours(k.nouvelle_valeur, langue)}`}</dd>
                        </div>
                        <div>
                          <dt>{t("Motif", "Reason")}</dt>
                          <dd className="mp-texte-preserve">{k.motif}</dd>
                        </div>
                        <div>
                          <dt>{t("Demandée le", "Requested on")}</dt>
                          <dd>{formaterDateHeure(k.demandee_le, "Africa/Abidjan", langue)}</dd>
                        </div>
                        {k.motif_rejet ? (
                          <div>
                            <dt>{t("Motif du rejet", "Reason for rejection")}</dt>
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
            libelle={t("Pages des corrections", "Correction pages")}
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
