import type { Metadata } from "next";
import { aPermission } from "@missionpilot/shared";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../lib/api-serveur";
import { obtenirLangue } from "../../../../lib/i18n/serveur";
import { formaterDate, formaterDateHeure } from "../../../../lib/format";
import {
  peutAnnulerAbsence,
  presentationStatutAbsence,
  TYPE_ABSENCE_LIBELLES,
  TYPE_ABSENCE_LIBELLES_EN,
  type Absence,
  type MonPlanning,
} from "../../../../lib/planification";
import { aujourdhuiIso } from "../../../../lib/semaine";
import { exigerPermission } from "../../../../lib/session";
import { AnnulationAbsence, DemandeAbsence } from "./Conges";

export async function generateMetadata(): Promise<Metadata> {
  const langue = await obtenirLangue();
  return { title: langue === "en" ? "My leave and absences" : "Mes congés et absences" };
}

const CURSEUR = /^[A-Za-z0-9_=-]{1,500}$/;

export default async function PageMesConges({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const langue = await obtenirLangue();
  const t = (fr: string, en: string) => (langue === "en" ? en : fr);
  const libType = (type: Absence["type"]) =>
    (langue === "en" ? TYPE_ABSENCE_LIBELLES_EN : TYPE_ABSENCE_LIBELLES)[type];
  const { utilisateur } = await exigerPermission("conges.demander");
  const brut = (await searchParams).curseur;
  const curseur = typeof brut === "string" && CURSEUR.test(brut) ? brut : "";
  const valideur = aPermission(utilisateur.roles, "conges.valider");
  // Un valideur reçoit toutes les demandes du cabinet : on filtre sur sa propre fiche.
  let filtre = "";
  if (valideur) {
    const moi = await chargerServeur<MonPlanning>("/api/mon-planning");
    if (moi.ok && moi.donnees.collaborateur)
      filtre = `&collaborateur_id=${moi.donnees.collaborateur.id}`;
  }
  const liste = await chargerServeur<{ elements: Absence[]; curseur_suivant: string | null }>(
    `/api/absences?limite=50${filtre}${curseur ? `&curseur=${encodeURIComponent(curseur)}` : ""}`,
  );
  const aujourdhui = aujourdhuiIso();
  const miennes = liste.ok
    ? liste.donnees.elements.filter((a) => a.demandeur_id === utilisateur.id)
    : [];

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Mes congés et absences", "My leave and absences")}
        soustitre={t(
          "Demandez une absence, suivez sa validation, annulez-la avant qu'elle ne commence. Seules les absences validées réduisent votre capacité.",
          "Request an absence, track its approval, cancel it before it starts. Only approved absences reduce your capacity.",
        )}
      />
      <Carte titre={t("Nouvelle demande", "New request")}>
        <DemandeAbsence aujourdhui={aujourdhui} />
      </Carte>

      <section aria-labelledby="titre-demandes" className="mp-pile">
        <h2 id="titre-demandes" className="mp-section__titre">
          {t("Mes demandes", "My requests")}
        </h2>
        {!liste.ok ? (
          <EtatErreur
            titre={t(
              "Vos demandes n'ont pas pu être chargées.",
              "Your requests could not be loaded.",
            )}
            message={liste.message}
            hrefReessayer="/planning/conges"
          />
        ) : miennes.length === 0 ? (
          <EtatVide
            titre={t("Aucune demande d'absence.", "No absence requests.")}
            icone="calendrier"
          >
            <p>
              {t(
                "Vos demandes apparaîtront ici avec leur état de validation.",
                "Your requests will appear here with their approval status.",
              )}
            </p>
          </EtatVide>
        ) : (
          <ul className="mp-liste-cartes">
            {miennes.map((a) => {
              const libelle = t(
                `${TYPE_ABSENCE_LIBELLES[a.type]} du ${formaterDate(a.date_debut)} au ${formaterDate(a.date_fin)}`,
                `${libType(a.type)} from ${formaterDate(a.date_debut, "UTC", langue)} to ${formaterDate(a.date_fin, "UTC", langue)}`,
              );
              const statut = presentationStatutAbsence(a.statut, langue);
              return (
                <li key={a.id}>
                  <Carte
                    niveauTitre={3}
                    titre={libType(a.type)}
                    actions={<BadgeStatut tonalite={statut.tonalite}>{statut.libelle}</BadgeStatut>}
                  >
                    <div className="mp-pile">
                      <dl className="mp-liste-def mp-liste-def--compacte">
                        <div>
                          <dt>{t("Période", "Period")}</dt>
                          <dd>
                            {t(
                              `Du ${formaterDate(a.date_debut)} au ${formaterDate(a.date_fin)}`,
                              `From ${formaterDate(a.date_debut, "UTC", langue)} to ${formaterDate(a.date_fin, "UTC", langue)}`,
                            )}
                          </dd>
                        </div>
                        {a.commentaire ? (
                          <div>
                            <dt>{t("Commentaire", "Comment")}</dt>
                            <dd className="mp-texte-preserve">{a.commentaire}</dd>
                          </div>
                        ) : null}
                        {a.statut === "refusee" && a.motif_refus ? (
                          <div>
                            <dt>{t("Motif du refus", "Reason for rejection")}</dt>
                            <dd className="mp-texte-preserve">{a.motif_refus}</dd>
                          </div>
                        ) : null}
                        {a.decide_le ? (
                          <div>
                            <dt>{t("Décidée le", "Decided on")}</dt>
                            <dd>{formaterDateHeure(a.decide_le, undefined, langue)}</dd>
                          </div>
                        ) : null}
                        <div>
                          <dt>{t("Demandée le", "Requested on")}</dt>
                          <dd>{formaterDateHeure(a.cree_le, undefined, langue)}</dd>
                        </div>
                      </dl>
                      {peutAnnulerAbsence(a, utilisateur.id, aujourdhui) ? (
                        <AnnulationAbsence id={a.id} libelle={libelle} />
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
            libelle={t("Pages des demandes", "Request pages")}
            hrefSuivante={
              liste.donnees.curseur_suivant
                ? `/planning/conges?curseur=${encodeURIComponent(liste.donnees.curseur_suivant)}`
                : null
            }
            hrefDebut={curseur ? "/planning/conges" : null}
          />
        ) : null}
      </section>
    </div>
  );
}
