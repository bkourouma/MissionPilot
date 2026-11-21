import type { ReactNode } from "react";
import {
  creerTraduire,
  TYPES_DOCUMENT,
  type Langue,
  type Traduire,
  type TypeDocument,
} from "@missionpilot/shared";
import {
  formaterAvancement,
  formaterValeurKpi,
  libelleElements,
  libelleFaitSaillant,
  resumeKpis,
  resumeLivrables,
  statutKpiAvancement,
  type ContenuAvancement,
  type ContenuAvancementPortail,
} from "../../lib/avancement";
import { formaterDate } from "../../lib/format";
import { obtenirLangue } from "../../lib/i18n/serveur";
import { libellePeriode } from "../../lib/kpi-libelles";
import { libelleTypeDocument } from "../../lib/missions-types";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Carte } from "../ui/Carte";
import "./avancement.css";

type Jalons = ContenuAvancement["jalons"];

/** Libellé lisible du type d'un livrable ; un type inconnu reste affiché tel quel. */
function typeLivrable(type: string, langue: Langue): string {
  return (TYPES_DOCUMENT as readonly string[]).includes(type)
    ? libelleTypeDocument(type as TypeDocument, langue)
    : type;
}

function ListeJalons({
  titre,
  liste,
  vide,
  t,
  langue,
}: {
  titre: string;
  liste: Jalons["atteints"];
  vide: string;
  t: Traduire;
  langue: Langue;
}) {
  return (
    <div>
      <h4 className="mp-carte__titre">{`${titre} (${liste.nombre})`}</h4>
      {liste.elements.length === 0 ? (
        <p className="mp-texte-doux">{vide}</p>
      ) : (
        <ul className="mp-avc-liste mp-avc-liste--nue">
          {liste.elements.map((j, i) => (
            <li key={`${j.libelle}-${i}`} className="mp-avc-ligne">
              <span>{j.libelle}</span>
              <span className="mp-texte-doux">
                {j.date_prevue
                  ? formaterDate(j.date_prevue, "UTC", langue)
                  : t("Sans date", "No date")}
              </span>
            </li>
          ))}
        </ul>
      )}
      {liste.nombre > liste.elements.length ? (
        <p className="mp-texte-doux mp-texte-petit">
          {t(
            `Seuls les ${liste.elements.length} premiers jalons sont détaillés.`,
            `Only the first ${liste.elements.length} milestones are detailed.`,
          )}
        </p>
      ) : null}
    </div>
  );
}

function Synthese({
  etiquette,
  valeur,
  detail,
}: {
  etiquette: string;
  valeur: string;
  detail: ReactNode;
}) {
  return (
    <div className="mp-avc-synthese__element">
      <dt className="mp-avc-synthese__etiquette">{etiquette}</dt>
      <dd className="mp-avc-synthese__valeur">{valeur}</dd>
      <dd className="mp-avc-synthese__detail">{detail}</dd>
    </div>
  );
}

/**
 * Chiffres d'un rapport d'avancement, EN LECTURE SEULE : tout vient du moteur (le contenu est servi
 * tel quel par l'API). `pourClient` : version du portail, sans le décompte des livrables non
 * partagés. Aucun champ de saisie ici.
 */
export async function ChiffresRapport({
  contenu,
  pourClient = false,
}: {
  contenu: ContenuAvancement | ContenuAvancementPortail;
  pourClient?: boolean;
}) {
  const langue = await obtenirLangue();
  const t = creerTraduire(langue);
  const { avancement, jalons, kpis, livrables } = contenu;
  return (
    <div className="mp-avc">
      <dl
        className="mp-avc-synthese"
        aria-label={t("Chiffres de la semaine", "This week's figures")}
      >
        <Synthese
          etiquette={t("Avancement", "Progress")}
          valeur={formaterAvancement(avancement.pourcentage, langue)}
          detail={
            avancement.pourcentage === null
              ? t("Pas encore mesurable", "Not yet measurable")
              : `${t("Sur", "Based on")} ${libelleElements(avancement.elements, langue).toLowerCase()}`
          }
        />
        <Synthese
          etiquette={t("Jalons atteints", "Milestones reached")}
          valeur={`${jalons.atteints.nombre} ${t("sur", "of")} ${jalons.total}`}
          detail={t(
            `${jalons.en_retard.nombre} en retard, ${jalons.a_venir.nombre} à venir`,
            `${jalons.en_retard.nombre} overdue, ${jalons.a_venir.nombre} upcoming`,
          )}
        />
        <Synthese
          etiquette={t("Indicateurs (KPI)", "KPIs")}
          valeur={String(kpis.total)}
          detail={resumeKpis(kpis, langue)}
        />
        <Synthese
          etiquette={
            pourClient
              ? t("Livrables partagés", "Shared deliverables")
              : t("Livrables", "Deliverables")
          }
          valeur={String(livrables.partages)}
          detail={
            pourClient || !("non_partages" in livrables)
              ? t("Disponibles dans vos documents", "Available in your documents")
              : resumeLivrables(livrables, langue)
          }
        />
      </dl>

      {contenu.faits_saillants.length > 0 ? (
        <Carte titre={t("Faits saillants", "Highlights")} niveauTitre={3}>
          <ul className="mp-avc-liste">
            {contenu.faits_saillants.map((f, i) => (
              <li key={`${f.code}-${i}`}>
                <span className="mp-texte-doux">{`${libelleFaitSaillant(f.code, langue)}${t(" : ", ": ")}`}</span>
                {f.texte}
              </li>
            ))}
          </ul>
        </Carte>
      ) : null}

      <Carte titre={t("Jalons", "Milestones")} niveauTitre={3}>
        {jalons.total === 0 ? (
          <p className="mp-texte-doux">
            {t(
              "Aucun jalon n'est défini pour cette mission.",
              "No milestone is defined for this engagement.",
            )}
          </p>
        ) : (
          <div className="mp-pile">
            <ListeJalons
              titre={t("En retard", "Overdue")}
              liste={jalons.en_retard}
              vide={t("Aucun jalon en retard.", "No overdue milestones.")}
              t={t}
              langue={langue}
            />
            <ListeJalons
              titre={t("À venir", "Upcoming")}
              liste={jalons.a_venir}
              vide={t("Aucun jalon à venir.", "No upcoming milestones.")}
              t={t}
              langue={langue}
            />
            <ListeJalons
              titre={t("Atteints", "Reached")}
              liste={jalons.atteints}
              vide={t("Aucun jalon atteint pour l'instant.", "No milestone reached yet.")}
              t={t}
              langue={langue}
            />
            {jalons.sans_date > 0 ? (
              <p className="mp-texte-doux">
                {t(
                  `${jalons.sans_date} jalon${jalons.sans_date > 1 ? "s" : ""} sans date prévue.`,
                  `${jalons.sans_date} milestone${jalons.sans_date > 1 ? "s" : ""} with no planned date.`,
                )}
              </p>
            ) : null}
          </div>
        )}
      </Carte>

      <Carte titre={t("Indicateurs (KPI)", "KPIs")} niveauTitre={3}>
        {kpis.elements.length === 0 ? (
          <p className="mp-texte-doux">
            {t(
              "Aucun indicateur n'est suivi pour cette mission.",
              "No KPI is tracked for this engagement.",
            )}
          </p>
        ) : (
          <ul className="mp-avc-liste mp-avc-liste--nue">
            {kpis.elements.map((k, i) => {
              const s = statutKpiAvancement(k.statut, langue);
              return (
                <li key={`${k.libelle}-${i}`} className="mp-avc-ligne">
                  <span>
                    <strong>{k.libelle}</strong>
                    {k.periode ? (
                      <span className="mp-texte-doux">{` · ${libellePeriode(k.periode, langue)}`}</span>
                    ) : null}
                  </span>
                  <span>
                    {`${formaterValeurKpi(k.valeur, k.unite, langue)}`}
                    {k.cible !== null ? (
                      <span className="mp-texte-doux">
                        {` (${t("cible", "target")} ${formaterValeurKpi(k.cible, k.unite, langue)})`}
                      </span>
                    ) : null}{" "}
                    <BadgeStatut tonalite={s.tonalite}>{s.libelle}</BadgeStatut>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Carte>

      <Carte titre={t("Livrables partagés", "Shared deliverables")} niveauTitre={3}>
        {livrables.elements.length === 0 ? (
          <p className="mp-texte-doux">
            {t(
              "Aucun livrable n'est partagé pour l'instant.",
              "No deliverable is shared at the moment.",
            )}
          </p>
        ) : (
          <ul className="mp-avc-liste mp-avc-liste--nue">
            {livrables.elements.map((l, i) => (
              <li key={`${l.nom}-${l.version}-${i}`} className="mp-avc-ligne">
                <span>{l.nom}</span>
                <span className="mp-texte-doux">{`${typeLivrable(l.type, langue)} · ${t("version", "version")} ${l.version}`}</span>
              </li>
            ))}
          </ul>
        )}
        {!pourClient && "non_partages" in livrables && livrables.non_partages > 0 ? (
          <p className="mp-texte-doux mp-texte-petit">
            {t(
              `${livrables.non_partages} livrable${livrables.non_partages > 1 ? "s" : ""} non partagé${livrables.non_partages > 1 ? "s" : ""} avec le client (non détaillé${livrables.non_partages > 1 ? "s" : ""}).`,
              `${livrables.non_partages} deliverable${livrables.non_partages > 1 ? "s" : ""} not shared with the client (not detailed).`,
            )}
          </p>
        ) : null}
      </Carte>
    </div>
  );
}
