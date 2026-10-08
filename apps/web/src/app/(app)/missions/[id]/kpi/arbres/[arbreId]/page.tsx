import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BoutonActionKpi } from "../../../../../../../components/kpi/BoutonActionKpi";
import { ContributionsArbreKpi } from "../../../../../../../components/kpi/ContributionsArbre";
import { FormulaireNoeud } from "../../../../../../../components/kpi/FormulairesArbreKpi";
import "../../../../../../../components/kpi/kpi.css";
import { Alerte } from "../../../../../../../components/ui/Alerte";
import { classesBouton } from "../../../../../../../components/ui/Bouton";
import { Carte } from "../../../../../../../components/ui/Carte";
import { Champ } from "../../../../../../../components/ui/Champ";
import { EtatErreur } from "../../../../../../../components/ui/EtatListe";
import { Tableau } from "../../../../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../../../../lib/api-serveur";
import { formaterDate } from "../../../../../../../lib/format";
import { estIdentifiant } from "../../../../../../../lib/identifiant";
import { ajouterJoursIso, droitsKpi } from "../../../../../../../lib/kpi";
import {
  cheminArbre,
  cheminContributions,
  cheminNoeud,
  hrefArbre,
  hrefArbres,
  LIBELLES_RELATION,
  type ContributionsArbre,
  type DetailArbre,
  type NoeudArbre,
} from "../../../../../../../lib/kpi-pilotage";
import { chargerOptionsPilotage } from "../../../../../../../lib/kpi-pilotage-serveur";
import { chargerMission } from "../../../../../../../lib/missions-serveur";
import { aujourdhui, dateValide } from "../../../../../../../lib/periode";
import { exigerPermission } from "../../../../../../../lib/session";

export const metadata: Metadata = { title: "Arbre d'indicateurs" };

const texte = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Un arbre d'indicateurs : ses nœuds, la décomposition chiffrée de la variation du KPI racine
 * entre deux dates d'arrêté (par défaut : il y a 90 jours et aujourd'hui) et, pour le responsable
 * de la mission, l'ajout et la désactivation de leviers.
 */
export default async function PageArbreKpi({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; arbreId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id, arbreId } = await params;
  if (!estIdentifiant(arbreId)) notFound();
  const { utilisateur } = await exigerPermission("kpi.lire");
  const r = await chargerMission(id);
  if (!r.ok) return null;
  const m = r.donnees;
  const droits = droitsKpi(utilisateur.roles, utilisateur.id, m);
  const jour = aujourdhui();
  const q = await searchParams;
  const apresBrut = texte(q.apres);
  const avantBrut = texte(q.avant);
  const apres = apresBrut && dateValide(apresBrut) ? apresBrut : jour;
  const avant = avantBrut && dateValide(avantBrut) ? avantBrut : ajouterJoursIso(apres, -90);
  const [arbre, contributions, options] = await Promise.all([
    chargerServeur<DetailArbre>(cheminArbre(arbreId)),
    avant < apres
      ? chargerServeur<ContributionsArbre>(cheminContributions(arbreId, avant, apres))
      : Promise.resolve(null),
    chargerOptionsPilotage(utilisateur.roles, m, m.id),
  ]);
  if (!arbre.ok && arbre.statut === 404) notFound();
  if (!arbre.ok) {
    return (
      <EtatErreur
        titre="L'arbre n'a pas pu être chargé."
        message={arbre.message}
        hrefReessayer={hrefArbre(m.id, arbreId)}
      />
    );
  }
  // Un arbre d'une autre mission que celle de l'URL n'existe pas pour cette page.
  if (arbre.donnees.mission_id !== m.id) notFound();
  const a = arbre.donnees;
  const parId = new Map(a.noeuds.map((n) => [n.id, n]));
  return (
    <div className="mp-kpi">
      <div className="mp-actions-formulaire">
        <Link href={hrefArbres(m.id)} className={classesBouton("secondaire")}>
          Revenir aux arbres
        </Link>
      </div>
      <h2 className="mp-kpi-section__titre">{a.libelle}</h2>
      {a.description ? <p className="mp-texte-doux">{a.description}</p> : null}

      <form method="get" action={hrefArbre(m.id, arbreId)} className="mp-kpi-barre" role="search">
        <div className="mp-kpi-barre__date">
          <Champ
            libelle="Situation « avant » (arrêté)"
            type="date"
            name="avant"
            defaultValue={avant}
            max={jour}
          />
          <Champ
            libelle="Situation « après » (arrêté)"
            type="date"
            name="apres"
            defaultValue={apres}
          />
          <button type="submit" className={classesBouton("secondaire")}>
            Décomposer
          </button>
        </div>
      </form>

      <Carte titre={`Contributions entre le ${formaterDate(avant)} et le ${formaterDate(apres)}`}>
        {contributions === null ? (
          <Alerte tonalite="attention" titre="Dates incohérentes" annonce="status">
            <p>La date « avant » doit précéder la date « après ».</p>
          </Alerte>
        ) : !contributions.ok ? (
          <EtatErreur
            titre="La décomposition n'a pas pu être calculée."
            message={contributions.message}
            hrefReessayer={hrefArbre(m.id, arbreId, `avant=${avant}&apres=${apres}`)}
          />
        ) : (
          <ContributionsArbreKpi contributions={contributions.donnees} />
        )}
      </Carte>

      <Carte titre="Nœuds de l'arbre">
        <Tableau<NoeudArbre>
          legende="Nœuds de l'arbre d'indicateurs"
          colonnes={[
            { cle: "libelle", entete: "Nœud" },
            {
              cle: "parent",
              entete: "Sous",
              rendu: (n) => (n.parent_id ? (parId.get(n.parent_id)?.libelle ?? "—") : "Racine"),
            },
            { cle: "kpi", entete: "KPI lié", rendu: (n) => n.kpi_libelle ?? "Levier libre" },
            {
              cle: "relation",
              entete: "Combine ses leviers en",
              rendu: (n) => LIBELLES_RELATION[n.relation],
            },
            { cle: "coefficient", entete: "Coefficient", alignement: "droite" },
            { cle: "rang", entete: "Rang", alignement: "droite" },
            { cle: "actif", entete: "Situation", rendu: (n) => (n.actif ? "Actif" : "Désactivé") },
            ...(droits.gerer
              ? [
                  {
                    cle: "action",
                    entete: "Action",
                    rendu: (n: NoeudArbre) =>
                      n.parent_id === null ? (
                        "—"
                      ) : (
                        <BoutonActionKpi
                          libelle={n.actif ? "Désactiver" : "Réactiver"}
                          chemin={cheminNoeud(n.id)}
                          methode="PATCH"
                          corps={{ actif: !n.actif }}
                          succes={n.actif ? "Levier désactivé." : "Levier réactivé."}
                          variante="discret"
                        />
                      ),
                  },
                ]
              : []),
          ]}
          lignes={a.noeuds}
          cleLigne={(n) => n.id}
        />
      </Carte>

      {droits.gerer ? (
        <Carte titre="Ajouter un levier">
          <FormulaireNoeud arbreId={arbreId} noeuds={a.noeuds} kpis={options.kpis} />
        </Carte>
      ) : null}
    </div>
  );
}
