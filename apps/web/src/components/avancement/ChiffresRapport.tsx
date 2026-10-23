import type { ReactNode } from "react";
import {
  formaterAvancement,
  formaterValeurKpi,
  libelleElements,
  LIBELLES_FAIT_SAILLANT,
  resumeKpis,
  resumeLivrables,
  STATUT_KPI_AVANCEMENT,
  type ContenuAvancement,
  type ContenuAvancementPortail,
} from "../../lib/avancement";
import { formaterDate } from "../../lib/format";
import { libellePeriode } from "../../lib/kpi-libelles";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Carte } from "../ui/Carte";
import "./avancement.css";

type Jalons = ContenuAvancement["jalons"];

function ListeJalons({
  titre,
  liste,
  vide,
}: {
  titre: string;
  liste: Jalons["atteints"];
  vide: string;
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
                {j.date_prevue ? formaterDate(j.date_prevue) : "Sans date"}
              </span>
            </li>
          ))}
        </ul>
      )}
      {liste.nombre > liste.elements.length ? (
        <p className="mp-texte-doux mp-texte-petit">
          {`Seuls les ${liste.elements.length} premiers jalons sont détaillés.`}
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
export function ChiffresRapport({
  contenu,
  pourClient = false,
}: {
  contenu: ContenuAvancement | ContenuAvancementPortail;
  pourClient?: boolean;
}) {
  const { avancement, jalons, kpis, livrables } = contenu;
  return (
    <div className="mp-avc">
      <dl className="mp-avc-synthese" aria-label="Chiffres de la semaine">
        <Synthese
          etiquette="Avancement"
          valeur={formaterAvancement(avancement.pourcentage)}
          detail={
            avancement.pourcentage === null
              ? "Pas encore mesurable"
              : `Sur ${libelleElements(avancement.elements).toLowerCase()}`
          }
        />
        <Synthese
          etiquette="Jalons atteints"
          valeur={`${jalons.atteints.nombre} sur ${jalons.total}`}
          detail={`${jalons.en_retard.nombre} en retard, ${jalons.a_venir.nombre} à venir`}
        />
        <Synthese
          etiquette="Indicateurs (KPI)"
          valeur={String(kpis.total)}
          detail={resumeKpis(kpis)}
        />
        <Synthese
          etiquette={pourClient ? "Livrables partagés" : "Livrables"}
          valeur={String(livrables.partages)}
          detail={
            pourClient || !("non_partages" in livrables)
              ? "Disponibles dans vos documents"
              : resumeLivrables(livrables)
          }
        />
      </dl>

      {contenu.faits_saillants.length > 0 ? (
        <Carte titre="Faits saillants" niveauTitre={3}>
          <ul className="mp-avc-liste">
            {contenu.faits_saillants.map((f, i) => (
              <li key={`${f.code}-${i}`}>
                <span className="mp-texte-doux">{`${LIBELLES_FAIT_SAILLANT[f.code]} : `}</span>
                {f.texte}
              </li>
            ))}
          </ul>
        </Carte>
      ) : null}

      <Carte titre="Jalons" niveauTitre={3}>
        {jalons.total === 0 ? (
          <p className="mp-texte-doux">Aucun jalon n&apos;est défini pour cette mission.</p>
        ) : (
          <div className="mp-pile">
            <ListeJalons titre="En retard" liste={jalons.en_retard} vide="Aucun jalon en retard." />
            <ListeJalons titre="À venir" liste={jalons.a_venir} vide="Aucun jalon à venir." />
            <ListeJalons
              titre="Atteints"
              liste={jalons.atteints}
              vide="Aucun jalon atteint pour l'instant."
            />
            {jalons.sans_date > 0 ? (
              <p className="mp-texte-doux">
                {`${jalons.sans_date} jalon${jalons.sans_date > 1 ? "s" : ""} sans date prévue.`}
              </p>
            ) : null}
          </div>
        )}
      </Carte>

      <Carte titre="Indicateurs (KPI)" niveauTitre={3}>
        {kpis.elements.length === 0 ? (
          <p className="mp-texte-doux">Aucun indicateur n&apos;est suivi pour cette mission.</p>
        ) : (
          <ul className="mp-avc-liste mp-avc-liste--nue">
            {kpis.elements.map((k, i) => {
              const s = STATUT_KPI_AVANCEMENT[k.statut];
              return (
                <li key={`${k.libelle}-${i}`} className="mp-avc-ligne">
                  <span>
                    <strong>{k.libelle}</strong>
                    {k.periode ? (
                      <span className="mp-texte-doux">{` · ${libellePeriode(k.periode)}`}</span>
                    ) : null}
                  </span>
                  <span>
                    {`${formaterValeurKpi(k.valeur, k.unite)}`}
                    {k.cible !== null ? (
                      <span className="mp-texte-doux">
                        {` (cible ${formaterValeurKpi(k.cible, k.unite)})`}
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

      <Carte titre="Livrables partagés" niveauTitre={3}>
        {livrables.elements.length === 0 ? (
          <p className="mp-texte-doux">Aucun livrable n&apos;est partagé pour l&apos;instant.</p>
        ) : (
          <ul className="mp-avc-liste mp-avc-liste--nue">
            {livrables.elements.map((l, i) => (
              <li key={`${l.nom}-${l.version}-${i}`} className="mp-avc-ligne">
                <span>{l.nom}</span>
                <span className="mp-texte-doux">{`${l.type} · version ${l.version}`}</span>
              </li>
            ))}
          </ul>
        )}
        {!pourClient && "non_partages" in livrables && livrables.non_partages > 0 ? (
          <p className="mp-texte-doux mp-texte-petit">
            {`${livrables.non_partages} livrable${livrables.non_partages > 1 ? "s" : ""} non partagé${livrables.non_partages > 1 ? "s" : ""} avec le client (non détaillé${livrables.non_partages > 1 ? "s" : ""}).`}
          </p>
        ) : null}
      </Carte>
    </div>
  );
}
