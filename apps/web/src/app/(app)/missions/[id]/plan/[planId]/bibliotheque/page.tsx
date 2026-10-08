import type { Metadata } from "next";
import { CreationDepuisBibliotheque } from "../../../../../../../components/plan/CreationDepuisBibliotheque";
import "../../../../../../../components/plan/plan-augmente.css";
import { Alerte } from "../../../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../../../components/ui/Carte";
import {
  EtatErreur,
  EtatVide,
  PaginationCurseur,
} from "../../../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../../../lib/api-serveur";
import { formaterMontantMineur } from "../../../../../../../lib/format";
import { chargerMission } from "../../../../../../../lib/missions-serveur";
import {
  cheminBibliothequePlan,
  hrefBibliothequePlan,
  libelleDuree,
  libelleEfficacite,
  libelleOrigine,
  libelleRisque,
  type PageBibliotheque,
} from "../../../../../../../lib/plan-bibliotheque";
import { personnesPlan } from "../../../../../../../lib/plan-elements";
import { chargerPlan } from "../../../../../../../lib/plan-serveur";
import {
  droitsPlan,
  libelleElement,
  MESSAGE_MISSION_CLOTUREE,
  type ContextePlan,
} from "../../../../../../../lib/plan-strategique";
import { chargerPersonnes } from "../../../../../../../lib/referentiels-serveur";
import { exigerPermission } from "../../../../../../../lib/session";

export const metadata: Metadata = { title: "Bibliothèque d'initiatives du plan" };

/**
 * Bibliothèque d'initiatives types (PLA-13) vue depuis un plan : coût, durée, risques et
 * efficacité observée dans des contextes semblables (synthèse du moteur côté API, échantillon
 * minimal affiché), et ajout d'une initiative au plan par les rédacteurs. Liste paginée
 * par curseur (100 types par page).
 */
export default async function PageBibliothequePlan({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; planId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id, planId } = await params;
  const brut = (await searchParams).curseur;
  const curseur = typeof brut === "string" && brut.length > 0 && brut.length <= 500 ? brut : null;
  const { utilisateur } = await exigerPermission("plan.lire");
  const [mission, r] = await Promise.all([chargerMission(id), chargerPlan(planId)]);
  // La mise en page affiche les erreurs de chargement (mission, plan).
  if (!mission.ok || !r.ok || r.donnees.mission_id !== mission.donnees.id) return null;
  const m = mission.donnees;
  const plan = r.donnees;
  const ctx: ContextePlan = { roles: utilisateur.roles, utilisateurId: utilisateur.id, mission: m };
  const droits = droitsPlan(ctx);
  const [b, cabinet] = await Promise.all([
    chargerServeur<PageBibliotheque>(cheminBibliothequePlan(planId, curseur)),
    droits.rediger ? chargerPersonnes(utilisateur.roles) : Promise.resolve([]),
  ]);
  if (!b.ok) {
    return (
      <EtatErreur
        titre="La bibliothèque d'initiatives n'a pas pu être chargée."
        message={b.message}
        hrefReessayer={hrefBibliothequePlan(id, planId)}
      />
    );
  }
  const page = b.donnees;
  const personnes = personnesPlan(cabinet, m.equipe, { id: utilisateur.id, nom: utilisateur.nom });
  const parents = plan.elements
    .filter((e) => (e.type === "axe" || e.type === "objectif") && !e.retire)
    .map((e) => ({ valeur: e.id, libelle: libelleElement(e) }));
  const contexte = [page.contexte.secteur, page.contexte.taille, page.contexte.pays].filter(
    Boolean,
  );

  return (
    <>
      {droits.cloturee ? (
        <Alerte tonalite="info" annonce="aucune">
          <p>{MESSAGE_MISSION_CLOTUREE}</p>
        </Alerte>
      ) : null}
      <Carte titre="Initiatives types du cabinet" niveauTitre={3}>
        <div className="mp-plan__section">
          <p className="mp-texte-doux mp-texte-petit">
            {contexte.length
              ? `Efficacité observée pour le contexte du client : ${contexte.join(" · ")}.`
              : "Le client n'a ni secteur, ni taille, ni pays renseignés : l'efficacité est celle de tous contextes."}{" "}
            Une moyenne n&apos;est affichée qu&apos;à partir d&apos;un échantillon suffisant.
          </p>
          {page.elements.length === 0 ? (
            <EtatVide titre="Bibliothèque vide." icone="livre">
              <p>
                Aucune initiative type n&apos;est disponible. Un expert métier ou un associé les
                rédige dans la bibliothèque du cabinet.
              </p>
            </EtatVide>
          ) : (
            <ul className="mp-liste-lignes" aria-label="Initiatives types">
              {page.elements.map((t) => (
                <li key={t.id} className="mp-liste-lignes__ligne">
                  <div className="mp-liste-lignes__texte">
                    <strong className="mp-coupure">{t.titre}</strong>
                    <span className="mp-texte-doux mp-texte-petit">
                      {[
                        libelleOrigine(t.origine),
                        `Coût type ${formaterMontantMineur(t.cout_type, t.devise)} (de ${formaterMontantMineur(t.cout_min, t.devise)} à ${formaterMontantMineur(t.cout_max, t.devise)})`,
                        libelleDuree(t.duree_type_jours),
                      ].join(" · ")}
                    </span>
                    {t.description ? <p className="mp-coupure">{t.description}</p> : null}
                    <span className="mp-texte-petit">{libelleEfficacite(t.efficacite)}</span>
                    {t.risques.length ? (
                      <ul className="mp-liste-simple" aria-label={`Risques de « ${t.titre} »`}>
                        {t.risques.map((x) => (
                          <li key={x.libelle}>{libelleRisque(x)}</li>
                        ))}
                      </ul>
                    ) : null}
                    {droits.rediger ? (
                      <CreationDepuisBibliotheque
                        planId={planId}
                        devisePlan={plan.devise}
                        type={t}
                        parents={parents}
                        personnes={personnes}
                      />
                    ) : null}
                  </div>
                  <div className="mp-badges">
                    <BadgeStatut tonalite="neutre">{`Version ${t.version}`}</BadgeStatut>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <PaginationCurseur
            libelle="Pages de la bibliothèque"
            hrefSuivante={
              page.curseur_suivant
                ? `${hrefBibliothequePlan(id, planId)}?curseur=${encodeURIComponent(page.curseur_suivant)}`
                : null
            }
            hrefDebut={curseur ? hrefBibliothequePlan(id, planId) : null}
          />
        </div>
      </Carte>
    </>
  );
}
