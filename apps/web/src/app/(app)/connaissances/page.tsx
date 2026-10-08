import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { aPermission, TYPES_RESULTAT_RECHERCHE } from "@missionpilot/shared";
import { Surligne } from "../../../components/connaissances/Surligne";
import { BadgeStatut } from "../../../components/ui/BadgeStatut";
import { Bouton } from "../../../components/ui/Bouton";
import { CaseACocher } from "../../../components/ui/CaseACocher";
import { Carte } from "../../../components/ui/Carte";
import { Champ } from "../../../components/ui/Champ";
import { EnteteDePage } from "../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../components/ui/EtatListe";
import { chargerServeur } from "../../../lib/api-serveur";
import {
  cheminRecherche,
  hrefResultat,
  libelleTypeResultat,
  lireCritereRecherche,
  type ReponseRecherche,
} from "../../../lib/capitalisation";
import { formaterDate } from "../../../lib/format";
import { obtenirSession } from "../../../lib/session";

export const metadata: Metadata = { title: "Recherche dans les connaissances" };

/**
 * Recherche unifiée (CAP-07) : missions, livrables, rapports, preuves et retours d'expérience,
 * en français sans tenir compte des accents, DANS LES DROITS de l'utilisateur (l'API ne
 * renvoie que ce qu'il peut ouvrir). Formulaire en GET : la recherche vit dans l'URL.
 */
export default async function PageRecherche({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { utilisateur } = await obtenirSession();
  if (!aPermission(utilisateur.roles, "connaissance.lire")) redirect("/connaissances/competences");
  const critere = lireCritereRecherche(await searchParams);
  const r = critere.q ? await chargerServeur<ReponseRecherche>(cheminRecherche(critere)) : null;

  return (
    <div className="mp-page mp-connaissances">
      <EnteteDePage
        titre="Recherche"
        soustitre="Une seule recherche dans les missions, livrables, rapports, preuves et retours d'expérience que vous avez le droit de consulter."
      />
      <Carte>
        <form
          className="mp-connaissances__recherche"
          method="get"
          action="/connaissances"
          role="search"
        >
          <Champ
            libelle="Rechercher"
            type="search"
            name="q"
            minLength={2}
            maxLength={200}
            defaultValue={critere.q}
            placeholder="Ex. atelier unique, relances clients…"
          />
          <fieldset className="mp-connaissances__types">
            <legend className="mp-texte-petit">Limiter à</legend>
            {TYPES_RESULTAT_RECHERCHE.map((t) => (
              <CaseACocher
                key={t}
                libelle={libelleTypeResultat(t)}
                name="types"
                value={t}
                defaultChecked={critere.types.includes(t)}
              />
            ))}
          </fieldset>
          <div>
            <Bouton type="submit" icone="recherche">
              Rechercher
            </Bouton>
          </div>
        </form>
      </Carte>
      {r === null ? (
        <EtatVide titre="Saisissez au moins deux caractères." icone="info" />
      ) : !r.ok ? (
        <EtatErreur
          titre="La recherche n'a pas abouti."
          message={r.message}
          hrefReessayer="/connaissances"
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide titre="Aucun résultat dans vos droits." />
      ) : (
        <Resultats r={r.donnees} q={critere.q} />
      )}
    </div>
  );
}

function Resultats({ r, q }: { r: ReponseRecherche; q: string }) {
  const tronques = Object.entries(r.par_type).filter(([, v]) => v?.tronque);
  return (
    <>
      {tronques.length > 0 ? (
        <p className="mp-texte-petit mp-texte-doux" role="status">
          D&apos;autres résultats existent : précisez la recherche ou limitez-la à un type.
        </p>
      ) : null}
      <ul className="mp-connaissances__resultats">
        {r.elements.map((e) => (
          <li key={`${e.type}-${e.id}`} className="mp-connaissances__resultat">
            <div className="mp-badges">
              <BadgeStatut tonalite="neutre" sansIcone>
                {libelleTypeResultat(e.type)}
              </BadgeStatut>
              <span className="mp-texte-petit mp-texte-doux">{formaterDate(e.date)}</span>
            </div>
            <Link href={hrefResultat(e)}>
              <strong>
                <Surligne texte={e.titre} q={q} />
              </strong>
            </Link>
            {e.extrait ? (
              <p className="mp-texte-petit">
                <Surligne texte={e.extrait} q={q} />
              </p>
            ) : null}
            {e.type !== "mission" ? (
              <p className="mp-texte-petit mp-texte-doux">Mission : {e.mission_intitule}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}
