import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  aPermission,
  TYPES_RESULTAT_RECHERCHE,
  type Langue,
  type Traduire,
} from "@missionpilot/shared";
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
import { obtenirLangue, obtenirT } from "../../../lib/i18n/serveur";
import { obtenirSession } from "../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Recherche dans les connaissances", "Knowledge search") };
}

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
  const t = await obtenirT();
  const langue = await obtenirLangue();
  if (!aPermission(utilisateur.roles, "connaissance.lire")) redirect("/connaissances/competences");
  const critere = lireCritereRecherche(await searchParams);
  const r = critere.q ? await chargerServeur<ReponseRecherche>(cheminRecherche(critere)) : null;

  return (
    <div className="mp-page mp-connaissances">
      <EnteteDePage
        titre={t("Recherche", "Search")}
        soustitre={t(
          "Une seule recherche dans les missions, livrables, rapports, preuves et retours d'expérience que vous avez le droit de consulter.",
          "One search across the engagements, deliverables, reports, evidence and lessons-learned reviews you are allowed to view.",
        )}
      />
      <Carte>
        <form
          className="mp-connaissances__recherche"
          method="get"
          action="/connaissances"
          role="search"
        >
          <Champ
            libelle={t("Rechercher", "Search")}
            type="search"
            name="q"
            minLength={2}
            maxLength={200}
            defaultValue={critere.q}
            placeholder={t(
              "Ex. atelier unique, relances clients…",
              "E.g. single workshop, client reminders…",
            )}
          />
          <fieldset className="mp-connaissances__types">
            <legend className="mp-texte-petit">{t("Limiter à", "Limit to")}</legend>
            {TYPES_RESULTAT_RECHERCHE.map((type) => (
              <CaseACocher
                key={type}
                libelle={libelleTypeResultat(type, langue)}
                name="types"
                value={type}
                defaultChecked={critere.types.includes(type)}
              />
            ))}
          </fieldset>
          <div>
            <Bouton type="submit" icone="recherche">
              {t("Rechercher", "Search")}
            </Bouton>
          </div>
        </form>
      </Carte>
      {r === null ? (
        <EtatVide
          titre={t("Saisissez au moins deux caractères.", "Enter at least two characters.")}
          icone="info"
        />
      ) : !r.ok ? (
        <EtatErreur
          titre={t("La recherche n'a pas abouti.", "The search did not succeed.")}
          message={r.message}
          hrefReessayer="/connaissances"
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide
          titre={t("Aucun résultat dans vos droits.", "No result within your permissions.")}
        />
      ) : (
        <Resultats r={r.donnees} q={critere.q} t={t} langue={langue} />
      )}
    </div>
  );
}

function Resultats({
  r,
  q,
  t,
  langue,
}: {
  r: ReponseRecherche;
  q: string;
  t: Traduire;
  langue: Langue;
}) {
  const tronques = Object.entries(r.par_type).filter(([, v]) => v?.tronque);
  return (
    <>
      {tronques.length > 0 ? (
        <p className="mp-texte-petit mp-texte-doux" role="status">
          {t(
            "D'autres résultats existent : précisez la recherche ou limitez-la à un type.",
            "More results exist: refine the search or limit it to one type.",
          )}
        </p>
      ) : null}
      <ul className="mp-connaissances__resultats">
        {r.elements.map((e) => (
          <li key={`${e.type}-${e.id}`} className="mp-connaissances__resultat">
            <div className="mp-badges">
              <BadgeStatut tonalite="neutre" sansIcone>
                {libelleTypeResultat(e.type, langue)}
              </BadgeStatut>
              <span className="mp-texte-petit mp-texte-doux">
                {formaterDate(e.date, "UTC", langue)}
              </span>
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
              <p className="mp-texte-petit mp-texte-doux">
                {t("Mission :", "Engagement:")} {e.mission_intitule}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}
