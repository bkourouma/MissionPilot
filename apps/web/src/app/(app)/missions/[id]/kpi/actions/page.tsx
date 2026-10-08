import Link from "next/link";
import type { Metadata } from "next";
import { FormulaireAction } from "../../../../../../components/kpi/FormulairesActionKpi";
import "../../../../../../components/kpi/kpi.css";
import { Alerte } from "../../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../../components/ui/BadgeStatut";
import { classesBouton } from "../../../../../../components/ui/Bouton";
import { Carte } from "../../../../../../components/ui/Carte";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../../../components/ui/EtatListe";
import { Tableau } from "../../../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../../../lib/api-serveur";
import { formaterDate } from "../../../../../../lib/format";
import { estIdentifiant } from "../../../../../../lib/identifiant";
import {
  cheminAlertesKpi,
  descriptionAlerte,
  droitsKpi,
  lireCurseur,
  hrefTableauKpi,
  type AlerteEnregistree,
  type PageKpi,
} from "../../../../../../lib/kpi";
import {
  cheminActionsMission,
  enRetard,
  hrefAction,
  hrefActions,
  LIBELLES_STATUT_ACTION,
  texteVerdict,
  type PageActions,
} from "../../../../../../lib/kpi-pilotage";
import { chargerOptionsPilotage } from "../../../../../../lib/kpi-pilotage-serveur";
import { chargerMission } from "../../../../../../lib/missions-serveur";
import { aujourdhui } from "../../../../../../lib/periode";
import { exigerPermission } from "../../../../../../lib/session";
import { STATUTS_ACTION_KPI } from "@missionpilot/shared";

export const metadata: Metadata = { title: "Actions correctives" };

const texte = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Registre des actions correctives de la mission (KPI-18) : chaque action est reliée au KPI (et à
 * l'alerte) qui l'a motivée, a un responsable, une échéance et un statut ; son efficacité est
 * mesurée par le moteur sur le KPI une fois l'action terminée. Une alerte se transforme en action
 * par `?kpi=…&alerte=…`.
 */
export default async function PageActionsKpi({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const { utilisateur } = await exigerPermission("kpi.lire");
  const r = await chargerMission(id);
  if (!r.ok) return null;
  const m = r.donnees;
  const q = await searchParams;
  const statutBrut = texte(q.statut);
  const statut = STATUTS_ACTION_KPI.find((s) => s === statutBrut);
  const curseur = lireCurseur(q.curseur);
  const kpiBrut = texte(q.kpi);
  const kpiPropose = kpiBrut && estIdentifiant(kpiBrut) ? kpiBrut : "";
  const alerteBrute = texte(q.alerte);
  const alertePropose = alerteBrute && estIdentifiant(alerteBrute) ? alerteBrute : "";
  const jour = aujourdhui();
  const droits = droitsKpi(utilisateur.roles, utilisateur.id, m);
  const requete = new URLSearchParams();
  if (statut) requete.set("statut", statut);
  if (curseur) requete.set("curseur", curseur);
  requete.set("limite", "25");
  const [actions, options, alertes] = await Promise.all([
    chargerServeur<PageActions>(cheminActionsMission(m.id, requete.toString())),
    chargerOptionsPilotage(utilisateur.roles, m, m.id),
    kpiPropose
      ? chargerServeur<PageKpi<AlerteEnregistree>>(cheminAlertesKpi(kpiPropose, { limite: 20 }))
      : Promise.resolve(null),
  ]);
  const filtre = (s?: string) => {
    const p = new URLSearchParams();
    if (s) p.set("statut", s);
    const t = p.toString();
    return t ? `${hrefActions(m.id)}?${t}` : hrefActions(m.id);
  };
  return (
    <div className="mp-kpi">
      <div className="mp-actions-formulaire">
        <Link href={hrefTableauKpi(m.id)} className={classesBouton("secondaire")}>
          Revenir au tableau de bord
        </Link>
      </div>
      <p className="mp-texte-doux">
        Une action corrective répond à une alerte ou à une décision de revue. Une fois terminée, le
        moteur compare le KPI avant et après sa date d&apos;effet : c&apos;est une variation
        observée, pas une preuve de causalité.
      </p>
      <nav aria-label="Filtrer par statut" className="mp-actions-formulaire">
        <Link href={filtre()} className={classesBouton(statut ? "discret" : "secondaire")}>
          Toutes
        </Link>
        {STATUTS_ACTION_KPI.map((s) => (
          <Link
            key={s}
            href={filtre(s)}
            className={classesBouton(statut === s ? "secondaire" : "discret")}
          >
            {LIBELLES_STATUT_ACTION[s]}
          </Link>
        ))}
      </nav>
      {!actions.ok ? (
        <EtatErreur
          titre="Les actions n'ont pas pu être chargées."
          message={actions.message}
          hrefReessayer={filtre(statut)}
        />
      ) : actions.donnees.elements.length === 0 ? (
        <EtatVide titre="Aucune action corrective." icone="info">
          <p>Enregistrez une action pour suivre ce qui est fait face à une alerte ou un écart.</p>
        </EtatVide>
      ) : (
        <>
          <Tableau
            legende="Actions correctives de la mission"
            colonnes={[
              { cle: "numero", entete: "N°", alignement: "droite" },
              {
                cle: "titre",
                entete: "Action",
                rendu: (a) => <Link href={hrefAction(m.id, a.id)}>{a.titre}</Link>,
              },
              { cle: "kpi_libelle", entete: "KPI" },
              { cle: "responsable_nom", entete: "Responsable" },
              {
                cle: "echeance",
                entete: "Échéance",
                rendu: (a) => (
                  <>
                    {formaterDate(a.echeance)}
                    {enRetard(a.echeance, a.statut, jour) ? (
                      <>
                        {" "}
                        <BadgeStatut tonalite="danger">En retard</BadgeStatut>
                      </>
                    ) : null}
                  </>
                ),
              },
              {
                cle: "statut",
                entete: "Statut",
                rendu: (a) => LIBELLES_STATUT_ACTION[a.statut],
              },
              {
                cle: "efficacite",
                entete: "Efficacité mesurée",
                rendu: (a) => (a.statut === "terminee" ? texteVerdict(a.efficacite) : "—"),
              },
            ]}
            lignes={actions.donnees.elements}
            cleLigne={(a) => a.id}
          />
          <PaginationCurseur
            hrefSuivante={
              actions.donnees.curseur_suivant
                ? `${filtre(statut)}${statut ? "&" : "?"}curseur=${encodeURIComponent(actions.donnees.curseur_suivant)}`
                : null
            }
            hrefDebut={curseur ? filtre(statut) : null}
          />
        </>
      )}
      {droits.saisir || droits.gerer ? (
        <Carte titre="Nouvelle action corrective">
          {options.erreurKpis ? (
            <Alerte tonalite="attention" titre="KPI indisponibles" annonce="aucune">
              <p>{options.erreurKpis}</p>
            </Alerte>
          ) : (
            <FormulaireAction
              key={`${kpiPropose}-${alertePropose}`}
              missionId={m.id}
              kpis={options.kpisActifs}
              alertes={
                alertes && alertes.ok
                  ? alertes.donnees.elements.map((a) => ({
                      valeur: a.id,
                      libelle: `${descriptionAlerte({ ...(a.details ?? {}), code: a.code, periode: a.periode }, "").titre} (${a.periode})`,
                    }))
                  : []
              }
              personnes={options.personnes}
              kpiId={kpiPropose}
              alerteId={alertePropose}
              jour={jour}
            />
          )}
        </Carte>
      ) : null}
    </div>
  );
}
