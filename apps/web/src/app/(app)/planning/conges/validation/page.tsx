import type { Metadata } from "next";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../lib/api-serveur";
import { obtenirLangue } from "../../../../../lib/i18n/serveur";
import { formaterDate, formaterDateHeure } from "../../../../../lib/format";
import {
  peutDeciderAbsence,
  presentationStatutAbsence,
  TYPE_ABSENCE_LIBELLES,
  TYPE_ABSENCE_LIBELLES_EN,
  type Absence,
} from "../../../../../lib/planification";
import { exigerPermission } from "../../../../../lib/session";
import { DecisionAbsence } from "../Conges";

export async function generateMetadata(): Promise<Metadata> {
  const langue = await obtenirLangue();
  return { title: langue === "en" ? "Leave to approve" : "Congés à valider" };
}

const CURSEUR = /^[A-Za-z0-9_=-]{1,500}$/;

export default async function PageCongesAValider({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const langue = await obtenirLangue();
  const t = (fr: string, en: string) => (langue === "en" ? en : fr);
  const libType = (type: Absence["type"]) =>
    (langue === "en" ? TYPE_ABSENCE_LIBELLES_EN : TYPE_ABSENCE_LIBELLES)[type];
  const { utilisateur } = await exigerPermission("conges.valider");
  const brut = (await searchParams).curseur;
  const curseur = typeof brut === "string" && CURSEUR.test(brut) ? brut : "";
  const liste = await chargerServeur<{ elements: Absence[]; curseur_suivant: string | null }>(
    `/api/absences?statut=demandee&limite=50${curseur ? `&curseur=${encodeURIComponent(curseur)}` : ""}`,
  );

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Congés à valider", "Leave to approve")}
        soustitre={t(
          "Demandes en attente, de la plus proche à la plus lointaine. Un refus exige un motif, transmis au collaborateur.",
          "Pending requests, from the nearest to the furthest. A rejection requires a reason, passed on to the team member.",
        )}
      />
      {!liste.ok ? (
        <EtatErreur
          titre={t("Les demandes n'ont pas pu être chargées.", "The requests could not be loaded.")}
          message={liste.message}
          hrefReessayer="/planning/conges/validation"
        />
      ) : liste.donnees.elements.length === 0 ? (
        <EtatVide titre={t("Aucune demande en attente.", "No pending requests.")} icone="succes">
          <p>
            {t(
              "Les nouvelles demandes d'absence apparaîtront ici.",
              "New absence requests will appear here.",
            )}
          </p>
        </EtatVide>
      ) : (
        <ul className="mp-liste-cartes">
          {liste.donnees.elements.map((a) => {
            const libelle = t(
              `${a.collaborateur_nom}, ${TYPE_ABSENCE_LIBELLES[a.type].toLowerCase()} du ${formaterDate(a.date_debut)} au ${formaterDate(a.date_fin)}`,
              `${a.collaborateur_nom}, ${libType(a.type).toLowerCase()} from ${formaterDate(a.date_debut, "UTC", langue)} to ${formaterDate(a.date_fin, "UTC", langue)}`,
            );
            return (
              <li key={a.id}>
                <Carte
                  niveauTitre={2}
                  titre={a.collaborateur_nom}
                  actions={
                    <BadgeStatut tonalite={presentationStatutAbsence(a.statut, langue).tonalite}>
                      {presentationStatutAbsence(a.statut, langue).libelle}
                    </BadgeStatut>
                  }
                >
                  <div className="mp-pile">
                    <dl className="mp-liste-def mp-liste-def--compacte">
                      <div>
                        <dt>{t("Type", "Type")}</dt>
                        <dd>{libType(a.type)}</dd>
                      </div>
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
                      <div>
                        <dt>{t("Demandée le", "Requested on")}</dt>
                        <dd>{formaterDateHeure(a.cree_le, undefined, langue)}</dd>
                      </div>
                    </dl>
                    {peutDeciderAbsence(a, utilisateur.roles, utilisateur.id) ? (
                      <DecisionAbsence id={a.id} libelle={libelle} />
                    ) : (
                      <p className="mp-texte-doux">
                        {t(
                          "C'est votre propre demande : un autre valideur la traitera.",
                          "This is your own request: another approver will handle it.",
                        )}
                      </p>
                    )}
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
              ? `/planning/conges/validation?curseur=${encodeURIComponent(liste.donnees.curseur_suivant)}`
              : null
          }
          hrefDebut={curseur ? "/planning/conges/validation" : null}
        />
      ) : null}
    </div>
  );
}
