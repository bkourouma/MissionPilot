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
import { obtenirLangue, obtenirT } from "../../../../../../../lib/i18n/serveur";
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
  messageMissionCloturee,
  type ContextePlan,
} from "../../../../../../../lib/plan-strategique";
import { chargerPersonnes } from "../../../../../../../lib/referentiels-serveur";
import { exigerPermission } from "../../../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Bibliothèque d'initiatives du plan", "Plan initiative library") };
}

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
  const t = await obtenirT();
  const langue = await obtenirLangue();
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
        titre={t(
          "La bibliothèque d'initiatives n'a pas pu être chargée.",
          "The initiative library could not be loaded.",
        )}
        message={b.message}
        hrefReessayer={hrefBibliothequePlan(id, planId)}
      />
    );
  }
  const page = b.donnees;
  const personnes = personnesPlan(
    cabinet,
    m.equipe,
    { id: utilisateur.id, nom: utilisateur.nom },
    langue,
  );
  const parents = plan.elements
    .filter((e) => (e.type === "axe" || e.type === "objectif") && !e.retire)
    .map((e) => ({ valeur: e.id, libelle: libelleElement(e, langue) }));
  const contexte = [page.contexte.secteur, page.contexte.taille, page.contexte.pays].filter(
    Boolean,
  );

  return (
    <>
      {droits.cloturee ? (
        <Alerte tonalite="info" annonce="aucune">
          <p>{messageMissionCloturee(langue)}</p>
        </Alerte>
      ) : null}
      <Carte titre={t("Initiatives types du cabinet", "Firm standard initiatives")} niveauTitre={3}>
        <div className="mp-plan__section">
          <p className="mp-texte-doux mp-texte-petit">
            {contexte.length
              ? t(
                  `Efficacité observée pour le contexte du client : ${contexte.join(" · ")}.`,
                  `Effectiveness observed for the client's context: ${contexte.join(" · ")}.`,
                )
              : t(
                  "Le client n'a ni secteur, ni taille, ni pays renseignés : l'efficacité est celle de tous contextes.",
                  "The client has no sector, size or country set: effectiveness is that of all contexts.",
                )}{" "}
            {t(
              "Une moyenne n'est affichée qu'à partir d'un échantillon suffisant.",
              "An average is shown only from a sufficient sample.",
            )}
          </p>
          {page.elements.length === 0 ? (
            <EtatVide titre={t("Bibliothèque vide.", "Empty library.")} icone="livre">
              <p>
                {t(
                  "Aucune initiative type n'est disponible. Un expert métier ou un associé les rédige dans la bibliothèque du cabinet.",
                  "No standard initiatives are available. A subject-matter expert or a partner writes them in the firm's library.",
                )}
              </p>
            </EtatVide>
          ) : (
            <ul
              className="mp-liste-lignes"
              aria-label={t("Initiatives types", "Standard initiatives")}
            >
              {page.elements.map((ty) => (
                <li key={ty.id} className="mp-liste-lignes__ligne">
                  <div className="mp-liste-lignes__texte">
                    <strong className="mp-coupure">{ty.titre}</strong>
                    <span className="mp-texte-doux mp-texte-petit">
                      {[
                        libelleOrigine(ty.origine, langue),
                        t(
                          `Coût type ${formaterMontantMineur(ty.cout_type, ty.devise)} (de ${formaterMontantMineur(ty.cout_min, ty.devise)} à ${formaterMontantMineur(ty.cout_max, ty.devise)})`,
                          `Standard cost ${formaterMontantMineur(ty.cout_type, ty.devise, langue)} (from ${formaterMontantMineur(ty.cout_min, ty.devise, langue)} to ${formaterMontantMineur(ty.cout_max, ty.devise, langue)})`,
                        ),
                        libelleDuree(ty.duree_type_jours, langue),
                      ].join(" · ")}
                    </span>
                    {ty.description ? <p className="mp-coupure">{ty.description}</p> : null}
                    <span className="mp-texte-petit">
                      {libelleEfficacite(ty.efficacite, langue)}
                    </span>
                    {ty.risques.length ? (
                      <ul
                        className="mp-liste-simple"
                        aria-label={t(
                          `Risques de « ${ty.titre} »`,
                          `Risks of \u201c${ty.titre}\u201d`,
                        )}
                      >
                        {ty.risques.map((x) => (
                          <li key={x.libelle}>{libelleRisque(x, langue)}</li>
                        ))}
                      </ul>
                    ) : null}
                    {droits.rediger ? (
                      <CreationDepuisBibliotheque
                        planId={planId}
                        devisePlan={plan.devise}
                        type={ty}
                        parents={parents}
                        personnes={personnes}
                      />
                    ) : null}
                  </div>
                  <div className="mp-badges">
                    <BadgeStatut tonalite="neutre">{`Version ${ty.version}`}</BadgeStatut>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <PaginationCurseur
            libelle={t("Pages de la bibliothèque", "Library pages")}
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
